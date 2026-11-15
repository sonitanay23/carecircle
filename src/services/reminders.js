import { addDays, localDate, localTime, weekday } from '../lib/time.js';
import { dosesOn, supplyStatus } from '../lib/schedule.js';
import { googleMapsSearchUrl } from '../lib/links.js';
import { messages } from '../notify/messages.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ACTION_TTL_SECONDS = 18 * 3600;
const WEEKLY_SUMMARY = { weekday: 0, time: '18:00' }; // Sunday evening, elder's time

/**
 * The reminder engine. Cloud Scheduler calls `runAll` every few minutes. Each
 * run looks at every profile and sends whatever is due:
 *
 *   dose due soon        → elder + caretakers (with a one-tap "I've taken it" link)
 *   dose missed          → elder + caretakers
 *   still missed later   → family (escalation)
 *   appointment          → everyone, the day before and 2 hours before
 *   medicine running low → everyone
 *   change waiting       → elder (to approve or say no)
 *   Sunday evening       → everyone: weekly adherence summary
 *
 * Every send goes through the notifier ledger, so runs can overlap or repeat
 * without anyone getting a message twice.
 */
export function createReminderService({
  store,
  profiles,
  medications,
  doses,
  appointments,
  changes,
  notifier,
  tokens,
  config,
  logger,
  now,
  assistant,
}) {
  const { leadMinutes, escalateAfterMinutes, lookbackHours } = config.reminders;
  const graceMs = config.missedAfterMinutes * MINUTE;
  const appUrl = config.appBaseUrl;

  const actionUrl = (pid, member, med, dose) =>
    `${appUrl}/a/${tokens.issue(
      {
        typ: 'action',
        act: 'dose_taken',
        pid,
        mid: member.id,
        v: member.tokenVersion,
        med: med.id,
        date: dose.date,
        time: dose.time,
      },
      { ttlSeconds: ACTION_TTL_SECONDS },
    )}`;

  async function remindDoses(ctx) {
    const { pid, profile, elder, members, stats } = ctx;
    const t = now();
    const today = localDate(t, profile.timezone);
    const yesterday = addDays(today, -1);
    const [meds, records] = await Promise.all([
      medications.all(pid),
      doses.history(pid, { from: yesterday, to: today }),
    ]);
    const byKey = new Map(records.map((r) => [r.id, r]));
    const carers = members.filter((m) => m.role === 'elder' || m.role === 'caretaker');
    const family = members.filter((m) => m.role === 'family');

    for (const med of meds) {
      for (const date of [yesterday, today]) {
        for (const dose of dosesOn(med, date, profile.timezone)) {
          const at = Date.parse(dose.scheduledAt);
          if (at < Date.parse(med.createdAt)) continue;
          let record = byKey.get(dose.key);
          const recent = at >= t - lookbackHours * HOUR;

          // 1. Coming up (or due right now) and not yet logged.
          if (!record && recent && t >= at - leadMinutes * MINUTE && t < at + graceMs) {
            const r = await notifier.send(pid, {
              id: `dose_upcoming_${dose.key}`,
              kind: 'dose_upcoming',
              ref: { medicationId: med.id, dose: dose.key },
              recipients: carers,
              build: (recipient) =>
                messages.dose_upcoming({
                  recipient,
                  elder,
                  med,
                  dose,
                  actionUrl: actionUrl(pid, recipient, med, dose),
                  appUrl,
                }),
            });
            stats.sent += r.sent;
            continue;
          }
          if (t < at + graceMs) continue;

          // 2. Past the missed window with nothing logged: record it as missed.
          if (!record) {
            record = await doses.markMissed(pid, med, dose);
            stats.markedMissed += 1;
          }
          if (record.status !== 'missed' || !recent) continue;

          const missed = await notifier.send(pid, {
            id: `dose_missed_${dose.key}`,
            kind: 'dose_missed',
            ref: { medicationId: med.id, dose: dose.key },
            recipients: carers,
            build: (recipient) =>
              messages.dose_missed({
                recipient,
                elder,
                med,
                dose,
                actionUrl: actionUrl(pid, recipient, med, dose),
                appUrl,
              }),
          });
          stats.sent += missed.sent;

          // 3. Still not taken a while later: let family know.
          if (t >= at + graceMs + escalateAfterMinutes * MINUTE) {
            const esc = await notifier.send(pid, {
              id: `dose_escalated_${dose.key}`,
              kind: 'dose_escalated',
              ref: { medicationId: med.id, dose: dose.key },
              recipients: family,
              build: (recipient) =>
                messages.dose_escalated({ recipient, elder, med, dose, appUrl }),
            });
            stats.sent += esc.sent;
          }
        }
      }

      // 4. Running low (sent once until the next refill resets it).
      const supply = supplyStatus(med);
      if (med.status === 'active' && supply?.low && !med.stock.lowNotifiedAt) {
        const r = await notifier.send(pid, {
          id: `low_stock_${med.id}_${med.stock.refills ?? 0}`, // each refill starts a new alert cycle
          kind: 'low_stock',
          ref: { medicationId: med.id },
          recipients: members,
          build: (recipient) =>
            messages.low_stock({
              recipient,
              elder,
              med,
              supply,
              appUrl,
              pharmacyUrl: googleMapsSearchUrl('pharmacy near me'),
            }),
        });
        if (r.sent || r.skipped || r.noRecipients)
          await medications.markLowStockNotified(pid, med.id);
        stats.sent += r.sent;
      }
    }
  }

  async function remindAppointments(ctx) {
    const { pid, elder, members, stats } = ctx;
    const t = now();
    const upcoming = await appointments.between(
      pid,
      new Date(t).toISOString(),
      new Date(t + 24 * HOUR).toISOString(),
    );
    for (const raw of upcoming) {
      const appointment = await appointments.get(pid, raw.id);
      const soon = Date.parse(appointment.startsAt) - t <= 2 * HOUR;
      const kind = soon ? 'appointment_soon' : 'appointment_day_before';
      // The day before, add a Gemini summary to take to the doctor (best effort).
      let visitSummary = null;
      if (
        !soon &&
        assistant?.enabled &&
        !(await notifier.alreadySent(pid, `${kind}_${appointment.id}`))
      ) {
        visitSummary = await assistant
          .visitSummary(pid, appointment.id, elder.language ?? 'en')
          .catch((err) => {
            logger.warn('visit_summary_failed', { error: err.message });
            return null;
          });
      }
      const r = await notifier.send(pid, {
        id: `${kind}_${appointment.id}`,
        kind,
        ref: { appointmentId: appointment.id },
        recipients: members,
        build: (recipient) =>
          messages.appointment({ recipient, elder, appointment, soon, appUrl, visitSummary }),
      });
      stats.sent += r.sent;
    }
  }

  async function remindApprovals(ctx) {
    const { pid, elder, stats } = ctx;
    const pending = await changes.list(pid, { status: 'pending' });
    for (const change of pending) {
      if (Date.parse(change.createdAt) < now() - 7 * 24 * HOUR) continue;
      const r = await notifier.send(pid, {
        id: `approval_${change.id}`,
        kind: 'approval_needed',
        ref: { changeId: change.id },
        recipients: [elder],
        build: () => messages.approval_needed({ elder, change, appUrl }),
      });
      stats.sent += r.sent;
    }
  }

  async function weeklySummary(ctx) {
    const { pid, profile, elder, members, stats } = ctx;
    const t = now();
    const today = localDate(t, profile.timezone);
    if (
      weekday(today) !== WEEKLY_SUMMARY.weekday ||
      localTime(t, profile.timezone) < WEEKLY_SUMMARY.time
    )
      return;
    const adherence = await doses.adherence(pid, { days: 7 });
    if (!adherence.totals.expected) return;
    const r = await notifier.send(pid, {
      id: `weekly_${today}`,
      kind: 'weekly_summary',
      recipients: members,
      build: (recipient) => messages.weekly_summary({ recipient, elder, adherence, appUrl }),
    });
    stats.sent += r.sent;
  }

  const api = {
    /** Runs every reminder check for one profile. */
    async runProfile(profile) {
      const pid = profile.id;
      const members = await profiles.listMembers(pid);
      const elder = members.find((m) => m.role === 'elder');
      if (!elder) return { sent: 0, markedMissed: 0 };
      const ctx = {
        pid,
        profile,
        elder,
        members: members.filter((m) => m.status === 'active'),
        stats: { sent: 0, markedMissed: 0 },
      };
      await remindDoses(ctx);
      await remindAppointments(ctx);
      await remindApprovals(ctx);
      await weeklySummary(ctx);
      return ctx.stats;
    },

    /** Runs for every profile. One failing profile never stops the others. */
    async runAll() {
      const started = now();
      const all = await store.collection('profiles').list();
      const totals = { profiles: all.length, sent: 0, markedMissed: 0, errors: 0 };
      for (const profile of all) {
        try {
          const s = await api.runProfile(profile);
          totals.sent += s.sent;
          totals.markedMissed += s.markedMissed;
        } catch (err) {
          totals.errors += 1;
          logger.error('reminder_profile_failed', { profileId: profile.id, err });
        }
      }
      totals.durationMs = now() - started;
      logger.info('reminders_run', totals);
      return totals;
    },

    /** Verifies a one-tap email link. Returns what it is for, or null if invalid. */
    async resolveAction(token) {
      const claims = tokens.verify(token);
      if (!claims || claims.typ !== 'action' || claims.act !== 'dose_taken') return null;
      const member = await profiles.getMember(claims.pid, claims.mid);
      if (!member || member.status !== 'active' || member.tokenVersion !== claims.v) return null;
      const med = await medications.getRaw(claims.pid, claims.med);
      if (!med) return null;
      return { pid: claims.pid, member, med, date: claims.date, time: claims.time };
    },
  };
  return api;
}
