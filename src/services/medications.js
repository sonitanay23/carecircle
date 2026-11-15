import { paths } from '../store/index.js';
import { HttpError } from '../lib/httpError.js';
import { newId } from '../lib/ids.js';
import { localDate } from '../lib/time.js';
import { supplyStatus } from '../lib/schedule.js';

export const MEDICATION_FORMS = Object.freeze([
  'tablet',
  'capsule',
  'liquid',
  'injection',
  'inhaler',
  'drops',
  'cream',
  'other',
]);
export const PHOTO_TYPES = Object.freeze({
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
});
export const MAX_PHOTO_BYTES = 512 * 1024;

const describe = (m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}`;
const describeTimes = (m) => (m.asNeeded ? 'when needed' : m.schedule.times.join(', '));

/** Normalises a schedule: sorted, de-duplicated times and weekdays. */
const cleanSchedule = (schedule) =>
  schedule
    ? {
        times: [...new Set(schedule.times)].sort(),
        days: [...new Set(schedule.days ?? [])].sort(),
        startDate: schedule.startDate,
        endDate: schedule.endDate ?? null,
      }
    : null;

/**
 * Medication list. Adding, changing and stopping medicines go through the
 * approval flow; refills and photos are day-to-day records and apply directly.
 */
export function createMedicationService({ store, activity, changes, profiles, now }) {
  const meds = (pid) => store.collection(paths.medications(pid));
  const photos = (pid) => store.collection(paths.photos(pid));
  const iso = () => new Date(now()).toISOString();

  const getOrThrow = async (pid, id) => {
    const med = await meds(pid).get(id);
    if (!med) throw new HttpError(404, 'Medicine not found', 'NOT_FOUND');
    return med;
  };

  const assertValidSchedule = (data) => {
    if (!data.asNeeded && !data.schedule?.times?.length) {
      throw new HttpError(
        400,
        'Add at least one time, or mark the medicine as "when needed".',
        'VALIDATION',
      );
    }
    if (data.schedule?.endDate && data.schedule.endDate < data.schedule.startDate) {
      throw new HttpError(400, 'The end date cannot be before the start date.', 'VALIDATION');
    }
  };

  changes.registerApplier('medication', async (pid, _actor, change) => {
    if (change.action === 'create') {
      const id = newId();
      await meds(pid).create(id, {
        ...change.data,
        status: 'active',
        stoppedOn: null,
        createdAt: iso(),
        updatedAt: iso(),
      });
      return { entityId: id };
    }
    const current = await getOrThrow(pid, change.targetId);
    if (current.status !== 'active')
      throw new HttpError(409, 'This medicine has already been stopped.', 'STOPPED');
    if (change.action === 'update') {
      const next = { ...current, ...change.data, updatedAt: iso() };
      assertValidSchedule(next);
      await meds(pid).set(current.id, next);
    } else if (change.action === 'stop') {
      const profile = await profiles.getProfile(pid);
      await meds(pid).update(current.id, {
        status: 'stopped',
        stoppedOn: localDate(now(), profile.timezone),
        updatedAt: iso(),
      });
    }
    return { entityId: current.id };
  });

  /** Adds computed fields for clients. */
  const view = (med, photoIds) => ({
    ...med,
    supply: supplyStatus(med),
    hasPhoto: photoIds ? photoIds.has(med.id) : undefined,
  });

  const api = {
    async list(pid, { includeStopped = false } = {}) {
      const all = await meds(pid).list({ orderBy: { field: 'name', direction: 'asc' } });
      const photoIds = new Set((await photos(pid).list()).map((p) => p.id));
      return all
        .filter((m) => includeStopped || m.status === 'active')
        .map((m) => view(m, photoIds));
    },

    async get(pid, id) {
      const med = await getOrThrow(pid, id);
      const photo = await photos(pid).get(id);
      return { ...view(med), hasPhoto: Boolean(photo) };
    },

    /** Raw documents for internal use (schedules, reminders). */
    async active(pid) {
      return (await meds(pid).list()).filter((m) => m.status === 'active');
    },
    async all(pid) {
      return meds(pid).list();
    },
    getRaw: (pid, id) => meds(pid).get(id),

    async proposeCreate(pid, actor, data) {
      const clean = {
        ...data,
        asNeeded: Boolean(data.asNeeded),
        schedule: data.asNeeded ? null : cleanSchedule(data.schedule),
      };
      assertValidSchedule(clean);
      return changes.propose(pid, actor, {
        entity: 'medication',
        action: 'create',
        data: clean,
        summary: `add ${describe(clean)} (${describeTimes(clean)})`,
      });
    },

    async proposeUpdate(pid, actor, id, patch) {
      const current = await getOrThrow(pid, id);
      if (current.status !== 'active')
        throw new HttpError(409, 'This medicine has already been stopped.', 'STOPPED');
      const data = { ...patch };
      if (data.schedule) data.schedule = cleanSchedule(data.schedule);
      if (data.asNeeded === true) data.schedule = null;
      assertValidSchedule({ ...current, ...data });
      const merged = { ...current, ...data };
      const fields = Object.keys(data).join(', ');
      return changes.propose(pid, actor, {
        entity: 'medication',
        action: 'update',
        targetId: id,
        data,
        summary: `change ${describe(current)} (${fields}${data.schedule ? `: now ${describeTimes(merged)}` : ''})`,
      });
    },

    async proposeStop(pid, actor, id) {
      const current = await getOrThrow(pid, id);
      if (current.status !== 'active')
        throw new HttpError(409, 'This medicine has already been stopped.', 'STOPPED');
      return changes.propose(pid, actor, {
        entity: 'medication',
        action: 'stop',
        targetId: id,
        summary: `stop ${describe(current)}`,
      });
    },

    /** Records new tablets bought. Applies directly: it is a fact, not a plan. */
    async refill(pid, actor, id, added) {
      const med = await getOrThrow(pid, id);
      const count = (med.stock?.count ?? 0) + added;
      const updated = await meds(pid).update(id, {
        stock: {
          perDose: 1,
          lowAtDays: 5,
          ...(med.stock ?? {}),
          count,
          lowNotifiedAt: null,
          refills: (med.stock?.refills ?? 0) + 1,
        },
        updatedAt: iso(),
      });
      await activity.record(pid, actor, {
        action: 'medication.refilled',
        summary: `${actor.name} added ${added} to ${describe(med)} (now ${count}).`,
        entity: 'medication',
        entityId: id,
      });
      return view(updated);
    },

    /** Adjusts stock when a dose is taken (-perDose) or un-taken (+perDose). */
    async adjustStock(pid, id, direction) {
      const med = await meds(pid).get(id);
      if (!med?.stock || typeof med.stock.count !== 'number') return null;
      const perDose = med.stock.perDose ?? 1;
      const count = Math.max(0, med.stock.count + direction * perDose);
      return meds(pid).update(id, { 'stock.count': count });
    },

    markLowStockNotified: (pid, id) => meds(pid).update(id, { 'stock.lowNotifiedAt': iso() }),

    /** Stores a small pill photo so the elder can recognise each tablet. */
    async setPhoto(pid, actor, id, contentType, buffer) {
      const med = await getOrThrow(pid, id);
      const signature = PHOTO_TYPES[contentType];
      if (!signature)
        throw new HttpError(415, 'Photos must be JPEG, PNG or WebP.', 'UNSUPPORTED_MEDIA');
      if (!Buffer.isBuffer(buffer) || buffer.length === 0)
        throw new HttpError(400, 'The photo is empty.', 'VALIDATION');
      if (buffer.length > MAX_PHOTO_BYTES)
        throw new HttpError(413, 'The photo is too large (max 512 KB).', 'TOO_LARGE');
      // Check the file really is the image type it claims to be.
      if (!signature.every((byte, i) => buffer[i] === byte)) {
        throw new HttpError(
          415,
          'That file does not look like a valid image.',
          'UNSUPPORTED_MEDIA',
        );
      }
      await photos(pid).set(id, {
        contentType,
        data: buffer.toString('base64'),
        bytes: buffer.length,
        updatedAt: iso(),
      });
      await activity.record(pid, actor, {
        action: 'medication.photo',
        summary: `${actor.name} added a photo of ${describe(med)}.`,
        entity: 'medication',
        entityId: id,
      });
    },

    async getPhoto(pid, id) {
      const photo = await photos(pid).get(id);
      if (!photo) throw new HttpError(404, 'No photo for this medicine yet.', 'NOT_FOUND');
      return {
        contentType: photo.contentType,
        buffer: Buffer.from(photo.data, 'base64'),
        updatedAt: photo.updatedAt,
      };
    },

    async deletePhoto(pid, actor, id) {
      const med = await getOrThrow(pid, id);
      await photos(pid).delete(id);
      await activity.record(pid, actor, {
        action: 'medication.photo_removed',
        summary: `${actor.name} removed the photo of ${describe(med)}.`,
        entity: 'medication',
        entityId: id,
      });
    },
  };
  return api;
}
