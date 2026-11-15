import { paths } from '../store/index.js';
import { HttpError } from '../lib/httpError.js';
import { addDays, dateRange, localDate, zonedToUtc } from '../lib/time.js';
import { dosesOn, doseKey, isScheduledOn, supplyStatus } from '../lib/schedule.js';

export const DOSE_STATUSES = Object.freeze(['taken', 'skipped']);
const EARLY_WINDOW_MS = 2 * 60 * 60 * 1000; // a dose can be logged up to 2 hours early
const DUE_SOON_MS = 30 * 60 * 1000;

const label = (med) => `${med.name}${med.dose ? ` ${med.dose}` : ''}`;

/**
 * The dose log: what was taken, skipped or missed, plus "today" and adherence
 * views. Doses are identified by medicine + local date + time, so logging the
 * same dose twice (e.g. from the app and from an email link) is harmless.
 */
export function createDoseService({ store, activity, medications, profiles, config, now }) {
  const doses = (pid) => store.collection(paths.doses(pid));
  const graceMs = config.missedAfterMinutes * 60_000;
  const iso = () => new Date(now()).toISOString();

  /** Live status for a scheduled dose that may or may not have a record. */
  const statusOf = (scheduledAtMs, record) => {
    if (record) return record.status;
    const t = now();
    if (t < scheduledAtMs - DUE_SOON_MS) return 'upcoming';
    if (t < scheduledAtMs + graceMs) return 'due';
    return 'missed';
  };

  const describeDose = (med, dose, record) => ({
    key: dose.key,
    medicationId: med.id,
    name: med.name,
    dose: med.dose ?? null,
    form: med.form ?? null,
    instructions: med.instructions ?? null,
    date: dose.date,
    time: dose.time,
    scheduledAt: dose.scheduledAt,
    status: statusOf(Date.parse(dose.scheduledAt), record),
    record: record ?? null,
  });

  const api = {
    /** Today's doses for the elder, in the elder's time zone, sorted by time. */
    async today(pid) {
      const profile = await profiles.getProfile(pid);
      const date = localDate(now(), profile.timezone);
      return api.forDate(pid, date, profile);
    },

    async forDate(pid, date, profile) {
      const p = profile ?? (await profiles.getProfile(pid));
      const [allMeds, records] = await Promise.all([medications.all(pid), doses(pid).list({ where: [['date', '==', date]] })]);
      const byKey = new Map(records.map((r) => [r.id, r]));
      const scheduled = allMeds
        .flatMap((med) => dosesOn(med, date, p.timezone).map((d) => describeDose(med, d, byKey.get(d.key))))
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.name.localeCompare(b.name));
      const asNeeded = records.filter((r) => r.asNeeded).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      return { date, timezone: p.timezone, doses: scheduled, asNeededTaken: asNeeded };
    },

    /**
     * Logs a dose as taken or skipped.
     * @param {{ medicationId: string, date?: string, time?: string, status: 'taken'|'skipped', note?: string, via?: string }} input
     */
    async record(pid, actor, { medicationId, date, time, status, note, via = 'app' }) {
      const med = await medications.getRaw(pid, medicationId);
      if (!med) throw new HttpError(404, 'Medicine not found', 'NOT_FOUND');
      const profile = await profiles.getProfile(pid);
      const recordedBy = { id: actor.id, name: actor.name, role: actor.role };

      if (med.asNeeded) {
        if (status !== 'taken') throw new HttpError(400, 'For "when needed" medicines, only log when it is taken.', 'VALIDATION');
        const at = now();
        const key = `${med.id}_prn_${at}`;
        const record = await doses(pid).create(key, {
          medicationId: med.id,
          medicationName: label(med),
          date: localDate(at, profile.timezone),
          time: null,
          scheduledAt: null,
          asNeeded: true,
          status: 'taken',
          recordedAt: iso(),
          recordedBy,
          via,
          note: note ?? null,
        });
        const updated = await medications.adjustStock(pid, med.id, -1);
        await activity.record(pid, actor, {
          action: 'dose.taken',
          summary: `${actor.name} logged ${label(med)} as taken (when needed).`,
          entity: 'medication',
          entityId: med.id,
        });
        return { dose: record, supply: updated ? supplyStatus(updated) : supplyStatus(med) };
      }

      if (!date || !time) throw new HttpError(400, 'date and time are required for scheduled medicines', 'VALIDATION');
      const key = doseKey(med.id, date, time);
      const existing = await doses(pid).get(key);
      if (!existing && (!isScheduledOn(med, date) || !med.schedule.times.includes(time))) {
        throw new HttpError(400, `${label(med)} is not scheduled at ${time} on ${date}.`, 'NOT_SCHEDULED');
      }
      const scheduledAtMs = zonedToUtc(date, time, profile.timezone);
      if (scheduledAtMs - now() > EARLY_WINDOW_MS) {
        throw new HttpError(400, 'That dose is not due yet. You can log it up to 2 hours early.', 'TOO_EARLY');
      }
      if (existing?.status === status) return { dose: existing, supply: supplyStatus(med), unchanged: true };

      // Keep the tablet count right when a dose changes between taken and not taken.
      const wasTaken = existing?.status === 'taken';
      const isTaken = status === 'taken';
      const updatedMed = wasTaken === isTaken ? null : await medications.adjustStock(pid, med.id, isTaken ? -1 : 1);

      const record = await doses(pid).set(key, {
        medicationId: med.id,
        medicationName: label(med),
        date,
        time,
        scheduledAt: new Date(scheduledAtMs).toISOString(),
        asNeeded: false,
        status,
        late: isTaken && now() > scheduledAtMs + graceMs,
        recordedAt: iso(),
        recordedBy,
        via,
        note: note ?? null,
        remindersSent: existing?.remindersSent ?? {},
      });
      await activity.record(pid, actor, {
        action: `dose.${status}`,
        summary: `${actor.name} marked ${label(med)} (${time}) as ${status}${record.late ? ' (late)' : ''}${via === 'email' ? ' from an email reminder' : ''}.`,
        entity: 'medication',
        entityId: med.id,
      });
      return { dose: record, supply: supplyStatus(updatedMed ?? med) };
    },

    /** Marks an unlogged dose as missed. Used by the reminder engine. */
    async markMissed(pid, med, dose) {
      const existing = await doses(pid).get(dose.key);
      if (existing) return existing;
      return doses(pid).create(dose.key, {
        medicationId: med.id,
        medicationName: label(med),
        date: dose.date,
        time: dose.time,
        scheduledAt: dose.scheduledAt,
        asNeeded: false,
        status: 'missed',
        late: false,
        recordedAt: iso(),
        recordedBy: { id: 'system', name: 'CareCircle', role: 'system' },
        via: 'system',
        note: null,
        remindersSent: {},
      });
    },

    getRecord: (pid, key) => doses(pid).get(key),
    updateRecord: (pid, key, patch) => doses(pid).update(key, patch),

    /** Dose records between two local dates (inclusive). */
    async history(pid, { from, to }) {
      return doses(pid).list({
        where: [
          ['date', '>=', from],
          ['date', '<=', to],
        ],
        orderBy: { field: 'date', direction: 'desc' },
      });
    },

    /**
     * Adherence over the last `days` days: doses taken vs expected, per medicine
     * and per day, plus a streak of fully-completed days. Unlogged doses count
     * only once their missed window has passed, so "later today" never counts against.
     */
    async adherence(pid, { days = 7 } = {}) {
      const profile = await profiles.getProfile(pid);
      const today = localDate(now(), profile.timezone);
      const from = addDays(today, -(days - 1));
      const [allMeds, records] = await Promise.all([medications.all(pid), api.history(pid, { from, to: today })]);
      const byKey = new Map(records.map((r) => [r.id, r]));

      const perMed = new Map();
      const perDay = [];
      for (const date of dateRange(from, today)) {
        const day = { date, expected: 0, taken: 0, skipped: 0, missed: 0 };
        for (const med of allMeds) {
          for (const dose of dosesOn(med, date, profile.timezone)) {
            const at = Date.parse(dose.scheduledAt);
            const rec = byKey.get(dose.key);
            if (at + graceMs > now() && !rec) continue; // still time to take it
            if (at < Date.parse(med.createdAt) && !rec) continue; // before the medicine was added
            const status = rec?.status ?? 'missed';
            const m = perMed.get(med.id) ?? { medicationId: med.id, name: label(med), expected: 0, taken: 0, late: 0, skipped: 0, missed: 0 };
            m.expected += 1;
            m[status] += 1;
            if (status === 'taken' && rec?.late) m.late += 1;
            perMed.set(med.id, m);
            day.expected += 1;
            day[status] += 1;
          }
        }
        perDay.push(day);
      }

      const totals = perDay.reduce(
        (acc, d) => ({ expected: acc.expected + d.expected, taken: acc.taken + d.taken, skipped: acc.skipped + d.skipped, missed: acc.missed + d.missed }),
        { expected: 0, taken: 0, skipped: 0, missed: 0 },
      );
      // Streak: consecutive most-recent days where every expected dose was taken.
      let streakDays = 0;
      for (const d of [...perDay].reverse()) {
        if (d.expected === 0) continue;
        if (d.taken === d.expected) streakDays += 1;
        else break;
      }
      const rate = (t, e) => (e ? Math.round((t / e) * 100) : null);
      return {
        from,
        to: today,
        timezone: profile.timezone,
        totals: { ...totals, adherencePercent: rate(totals.taken, totals.expected) },
        streakDays,
        medications: [...perMed.values()].map((m) => ({ ...m, adherencePercent: rate(m.taken, m.expected) })),
        days: perDay.map((d) => ({ ...d, adherencePercent: rate(d.taken, d.expected) })),
      };
    },
  };
  return api;
}
