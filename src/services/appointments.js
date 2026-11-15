import { paths } from '../store/index.js';
import { HttpError } from '../lib/httpError.js';
import { newId } from '../lib/ids.js';
import { zonedToUtc } from '../lib/time.js';
import { googleCalendarUrl, googleMapsDirectionsUrl, googleMapsSearchUrl } from '../lib/links.js';

/**
 * Doctor appointments. Booking, changing and cancelling go through the elder's
 * approval; marking one as attended is a simple record. Each appointment comes
 * with "Add to Google Calendar" and Google Maps links (no sign-in needed).
 */
export function createAppointmentService({ store, activity, changes, profiles, now }) {
  const appts = (pid) => store.collection(paths.appointments(pid));
  const iso = () => new Date(now()).toISOString();

  const withTimes = (data, timeZone) => {
    const startMs = zonedToUtc(data.date, data.time, timeZone);
    return {
      ...data,
      durationMinutes: data.durationMinutes ?? 30,
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(startMs + (data.durationMinutes ?? 30) * 60_000).toISOString(),
    };
  };

  const getOrThrow = async (pid, id) => {
    const a = await appts(pid).get(id);
    if (!a) throw new HttpError(404, 'Appointment not found', 'NOT_FOUND');
    return a;
  };

  changes.registerApplier('appointment', async (pid, _actor, change) => {
    const profile = await profiles.getProfile(pid);
    if (change.action === 'create') {
      const id = newId();
      await appts(pid).create(id, {
        ...withTimes(change.data, profile.timezone),
        status: 'scheduled',
        createdAt: iso(),
        updatedAt: iso(),
      });
      return { entityId: id };
    }
    const current = await getOrThrow(pid, change.targetId);
    if (current.status !== 'scheduled')
      throw new HttpError(409, `This appointment is already ${current.status}.`, 'NOT_SCHEDULED');
    if (change.action === 'update') {
      await appts(pid).set(current.id, {
        ...withTimes({ ...current, ...change.data }, profile.timezone),
        updatedAt: iso(),
      });
    } else if (change.action === 'cancel') {
      await appts(pid).update(current.id, { status: 'cancelled', updatedAt: iso() });
    }
    return { entityId: current.id };
  });

  const placeText = (a) => [a.location?.name, a.location?.address].filter(Boolean).join(', ');

  /** Adds Calendar and Maps links for clients. */
  const view = (a, elderName) => {
    const place = placeText(a);
    return {
      ...a,
      links: {
        googleCalendar: googleCalendarUrl({
          title: `${a.title}${elderName ? ` (${elderName})` : ''}`,
          startMs: Date.parse(a.startsAt),
          endMs: Date.parse(a.endsAt),
          details: [a.doctor && `Doctor: ${a.doctor}`, a.notes, 'Added from CareCircle']
            .filter(Boolean)
            .join('\n'),
          location: place || undefined,
        }),
        directions: place ? googleMapsDirectionsUrl(place) : null,
        map: place ? googleMapsSearchUrl(place) : null,
        nearbyPharmacies: a.location?.address
          ? googleMapsSearchUrl(`pharmacy near ${a.location.address}`)
          : null,
      },
    };
  };

  const label = (a) => `${a.title} on ${a.date} at ${a.time}`;

  const api = {
    /** when: 'upcoming' (default), 'past' or 'all'. Cancelled ones only appear in 'all'. */
    async list(pid, { when = 'upcoming' } = {}) {
      const profile = await profiles.getProfile(pid);
      const all = await appts(pid).list({ orderBy: { field: 'startsAt', direction: 'asc' } });
      const t = now();
      const filtered = all.filter((a) => {
        if (when === 'all') return true;
        if (a.status === 'cancelled') return false;
        const ended = Date.parse(a.endsAt) < t;
        return when === 'past'
          ? ended || a.status === 'completed'
          : !ended && a.status === 'scheduled';
      });
      if (when === 'past') filtered.reverse();
      return filtered.map((a) => view(a, profile.elderName));
    },

    async get(pid, id) {
      const profile = await profiles.getProfile(pid);
      return view(await getOrThrow(pid, id), profile.elderName);
    },

    /** Raw scheduled appointments between two instants (used by reminders). */
    async between(pid, fromIso, toIso) {
      const list = await appts(pid).list({
        where: [
          ['startsAt', '>=', fromIso],
          ['startsAt', '<', toIso],
        ],
      });
      return list.filter((a) => a.status === 'scheduled');
    },
    markReminded: (pid, id, kind) => appts(pid).update(id, { [`remindersSent.${kind}`]: iso() }),

    async proposeCreate(pid, actor, data) {
      const profile = await profiles.getProfile(pid);
      if (zonedToUtc(data.date, data.time, profile.timezone) < now()) {
        throw new HttpError(400, 'That date and time has already passed.', 'IN_PAST');
      }
      return changes.propose(pid, actor, {
        entity: 'appointment',
        action: 'create',
        data,
        summary: `book ${label(data)}`,
      });
    },

    async proposeUpdate(pid, actor, id, patch) {
      const current = await getOrThrow(pid, id);
      if (current.status !== 'scheduled')
        throw new HttpError(409, `This appointment is already ${current.status}.`, 'NOT_SCHEDULED');
      const merged = { ...current, ...patch };
      return changes.propose(pid, actor, {
        entity: 'appointment',
        action: 'update',
        targetId: id,
        data: patch,
        summary: `change ${current.title} (now ${merged.date} at ${merged.time})`,
      });
    },

    async proposeCancel(pid, actor, id) {
      const current = await getOrThrow(pid, id);
      if (current.status !== 'scheduled')
        throw new HttpError(409, `This appointment is already ${current.status}.`, 'NOT_SCHEDULED');
      return changes.propose(pid, actor, {
        entity: 'appointment',
        action: 'cancel',
        targetId: id,
        summary: `cancel ${label(current)}`,
      });
    },

    async markAttended(pid, actor, id, notes) {
      const current = await getOrThrow(pid, id);
      if (current.status !== 'scheduled')
        throw new HttpError(409, `This appointment is already ${current.status}.`, 'NOT_SCHEDULED');
      const updated = await appts(pid).update(id, {
        status: 'completed',
        visitNotes: notes ?? null,
        updatedAt: iso(),
      });
      await activity.record(pid, actor, {
        action: 'appointment.completed',
        summary: `${actor.name} marked ${current.title} as attended.`,
        entity: 'appointment',
        entityId: id,
      });
      return updated;
    },
  };
  return api;
}
