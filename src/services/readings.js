import { paths } from '../store/index.js';
import { HttpError } from '../lib/httpError.js';
import { newId } from '../lib/ids.js';

/**
 * Health readings (blood pressure, sugar...) to share with the doctor.
 * CareCircle does not interpret readings. It only marks values outside common
 * general reference ranges as "worth mentioning to your doctor".
 */
export const READING_TYPES = Object.freeze({
  bp: { label: 'Blood pressure', unit: 'mmHg' },
  sugar: { label: 'Blood sugar', unit: 'mg/dL' },
  pulse: { label: 'Pulse', unit: 'bpm' },
  spo2: { label: 'Oxygen level', unit: '%' },
  temperature: { label: 'Temperature', unit: '°C' },
  weight: { label: 'Weight', unit: 'kg' },
});
export const SUGAR_CONTEXTS = Object.freeze(['fasting', 'after_meal', 'random']);

// Physically plausible limits, to catch typing mistakes (not medical judgements).
const PLAUSIBLE = {
  systolic: [50, 260],
  diastolic: [30, 160],
  sugar: [20, 700],
  pulse: [25, 250],
  spo2: [50, 100],
  temperature: [30, 44],
  weight: [20, 300],
};

/** True when a reading is outside widely used general reference ranges. */
function outsideTypicalRange(r) {
  switch (r.type) {
    case 'bp':
      return r.systolic >= 140 || r.diastolic >= 90 || r.systolic < 90 || r.diastolic < 60;
    case 'sugar':
      if (r.value < 70) return true;
      return r.context === 'fasting' ? r.value >= 126 : r.value >= 200;
    case 'pulse':
      return r.value < 50 || r.value > 110;
    case 'spo2':
      return r.value < 94;
    case 'temperature':
      return r.value >= 38 || r.value < 35;
    default:
      return false;
  }
}

const formatValue = (r) => (r.type === 'bp' ? `${r.systolic}/${r.diastolic}` : `${r.value}`) + ` ${READING_TYPES[r.type].unit}`;

export function createReadingService({ store, activity, now }) {
  const readings = (pid) => store.collection(paths.readings(pid));
  const iso = () => new Date(now()).toISOString();

  const checkPlausible = (field, value) => {
    const [min, max] = PLAUSIBLE[field];
    if (typeof value !== 'number' || value < min || value > max) {
      throw new HttpError(400, `That ${field} value looks wrong. Please check it (expected ${min}–${max}).`, 'VALIDATION');
    }
  };

  const view = (r) => ({ ...r, unit: READING_TYPES[r.type].unit, display: formatValue(r), flag: outsideTypicalRange(r) ? 'discuss_with_doctor' : null });

  return {
    async add(pid, actor, input) {
      const { type } = input;
      let values;
      if (type === 'bp') {
        checkPlausible('systolic', input.systolic);
        checkPlausible('diastolic', input.diastolic);
        if (input.diastolic >= input.systolic) throw new HttpError(400, 'The lower number should be smaller than the upper number.', 'VALIDATION');
        values = { systolic: input.systolic, diastolic: input.diastolic };
      } else {
        checkPlausible(type, input.value);
        values = { value: input.value };
      }
      if (type === 'sugar' && !input.context) throw new HttpError(400, 'Say whether the sugar reading was fasting, after a meal, or random.', 'VALIDATION');
      const takenAt = input.takenAt ?? iso();
      if (Date.parse(takenAt) > now() + 5 * 60_000) throw new HttpError(400, 'A reading cannot be in the future.', 'VALIDATION');

      const record = await readings(pid).create(newId(), {
        type,
        ...values,
        context: type === 'sugar' ? input.context : null,
        note: input.note ?? null,
        takenAt,
        recordedAt: iso(),
        recordedBy: { id: actor.id, name: actor.name, role: actor.role },
      });
      const v = view(record);
      await activity.record(pid, actor, {
        action: 'reading.added',
        summary: `${actor.name} logged ${READING_TYPES[type].label.toLowerCase()}: ${v.display}.`,
        entity: 'reading',
        entityId: record.id,
      });
      return v;
    },

    /** Readings in the last `days` days, newest first, with a per-type summary. */
    async list(pid, { type, days = 30 } = {}) {
      const since = new Date(now() - days * 86_400_000).toISOString();
      const all = await readings(pid).list({ where: [['takenAt', '>=', since]], orderBy: { field: 'takenAt', direction: 'desc' } });
      const items = (type ? all.filter((r) => r.type === type) : all).map(view);

      const summary = {};
      for (const r of items) {
        const s = (summary[r.type] ??= { type: r.type, label: READING_TYPES[r.type].label, unit: r.unit, count: 0, flagged: 0, latest: r });
        s.count += 1;
        if (r.flag) s.flagged += 1;
      }
      for (const s of Object.values(summary)) {
        const ofType = items.filter((r) => r.type === s.type);
        const avg = (key) => Math.round(ofType.reduce((sum, r) => sum + r[key], 0) / ofType.length);
        s.average = s.type === 'bp' ? { systolic: avg('systolic'), diastolic: avg('diastolic') } : { value: Math.round((ofType.reduce((x, r) => x + r.value, 0) / ofType.length) * 10) / 10 };
      }
      return { readings: items, summary: Object.values(summary) };
    },

    /** The person who logged a reading, or the elder, can delete a mistake. */
    async remove(pid, actor, id) {
      const r = await readings(pid).get(id);
      if (!r) throw new HttpError(404, 'Reading not found', 'NOT_FOUND');
      if (actor.role !== 'elder' && r.recordedBy.id !== actor.id) {
        throw new HttpError(403, 'Only the person who logged it, or the elder, can delete a reading.', 'FORBIDDEN');
      }
      await readings(pid).delete(id);
      await activity.record(pid, actor, {
        action: 'reading.deleted',
        summary: `${actor.name} deleted a ${READING_TYPES[r.type].label.toLowerCase()} reading (${formatValue(r)}).`,
        entity: 'reading',
        entityId: id,
      });
    },
  };
}
