import express, { Router } from 'express';
import { HttpError } from '../lib/httpError.js';
import { requirePermission } from '../middleware/auth.js';
import { MEDICATION_FORMS, PHOTO_TYPES, MAX_PHOTO_BYTES } from '../services/medications.js';
import { DOSE_STATUSES } from '../services/doses.js';
import { READING_TYPES, SUGAR_CONTEXTS } from '../services/readings.js';
import { addDays } from '../lib/time.js';
import {
  parse,
  string,
  oneOf,
  boolean,
  integer,
  number,
  array,
  object,
  optional,
  timeOfDay,
  isoDate,
  isoDateTime,
} from '../lib/validate.js';

const text = (max) => optional(string({ max }));

const medicationFields = {
  name: string({ max: 80 }),
  dose: text(40),
  form: optional(oneOf(MEDICATION_FORMS)),
  instructions: text(200),
  purpose: text(200),
  prescribedBy: text(80),
  asNeeded: optional(boolean()),
  schedule: optional(
    object({
      times: array(timeOfDay(), { max: 8 }),
      days: optional(array(integer({ min: 0, max: 6 }), { max: 7 })),
      startDate: isoDate(),
      endDate: optional(isoDate()),
    }),
  ),
  stock: optional(
    object({
      count: integer({ min: 0, max: 10_000 }),
      perDose: optional(integer({ min: 1, max: 20 })),
      lowAtDays: optional(integer({ min: 1, max: 60 })),
    }),
  ),
};

const appointmentFields = {
  title: string({ max: 100 }),
  doctor: text(80),
  specialty: text(60),
  date: isoDate(),
  time: timeOfDay(),
  durationMinutes: optional(integer({ min: 5, max: 480 })),
  location: optional(object({ name: text(100), address: text(200) })),
  notes: text(500),
};

const schemas = {
  dose: {
    medicationId: string({ max: 64 }),
    date: optional(isoDate()),
    time: optional(timeOfDay()),
    status: oneOf(DOSE_STATUSES),
    note: text(200),
  },
  refill: { added: integer({ min: 1, max: 1000 }) },
  attended: { notes: text(1000) },
  reading: {
    type: oneOf(Object.keys(READING_TYPES)),
    systolic: optional(integer({ min: 1, max: 400 })),
    diastolic: optional(integer({ min: 1, max: 300 })),
    value: optional(number({ min: 0, max: 1000 })),
    context: optional(oneOf(SUGAR_CONTEXTS)),
    takenAt: optional(isoDateTime()),
    note: text(200),
  },
};

/** 202 when the change waits for the elder, 200 when it was applied. */
const sendOutcome = (res, outcome) =>
  res.status(outcome.status === 'pending' ? 202 : 200).json({ status: outcome.status, change: outcome.change });

const intQuery = (value, { fallback, min, max, name }) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}`, 'VALIDATION');
  return n;
};

export function careRouter({ services }) {
  const { medications, doses, appointments, readings } = services;
  const router = Router();
  const read = requirePermission('care:read');
  const record = requirePermission('care:record');
  const propose = requirePermission('changes:propose');

  // ---------- Medications ----------
  router.get('/medications', read, async (req, res) => {
    res.json({ medications: await medications.list(req.auth.profileId, { includeStopped: req.query.include === 'stopped' }) });
  });

  router.get('/medications/:id', read, async (req, res) => {
    res.json({ medication: await medications.get(req.auth.profileId, req.params.id) });
  });

  router.post('/medications', propose, async (req, res) => {
    const data = parse(req.body, medicationFields);
    sendOutcome(res, await medications.proposeCreate(req.auth.profileId, req.auth.member, data));
  });

  router.patch('/medications/:id', propose, async (req, res) => {
    const patch = parse(req.body, medicationFields, { partial: true });
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to change', 'VALIDATION');
    sendOutcome(res, await medications.proposeUpdate(req.auth.profileId, req.auth.member, req.params.id, patch));
  });

  router.delete('/medications/:id', propose, async (req, res) => {
    sendOutcome(res, await medications.proposeStop(req.auth.profileId, req.auth.member, req.params.id));
  });

  router.post('/medications/:id/refill', record, async (req, res) => {
    const { added } = parse(req.body, schemas.refill);
    res.json({ medication: await medications.refill(req.auth.profileId, req.auth.member, req.params.id, added) });
  });

  // Pill photos are uploaded as the raw image body (Content-Type: image/jpeg etc.).
  router.put(
    '/medications/:id/photo',
    record,
    express.raw({ type: Object.keys(PHOTO_TYPES), limit: MAX_PHOTO_BYTES }),
    async (req, res) => {
      await medications.setPhoto(req.auth.profileId, req.auth.member, req.params.id, req.get('content-type')?.split(';')[0], req.body);
      res.status(204).end();
    },
  );

  router.get('/medications/:id/photo', read, async (req, res) => {
    const photo = await medications.getPhoto(req.auth.profileId, req.params.id);
    res.set({ 'Content-Type': photo.contentType, 'Cache-Control': 'private, max-age=3600', 'Last-Modified': new Date(photo.updatedAt).toUTCString() });
    res.send(photo.buffer);
  });

  router.delete('/medications/:id/photo', record, async (req, res) => {
    await medications.deletePhoto(req.auth.profileId, req.auth.member, req.params.id);
    res.status(204).end();
  });

  // ---------- Doses & adherence ----------
  router.get('/doses/today', read, async (req, res) => {
    res.json(await doses.today(req.auth.profileId));
  });

  router.post('/doses', record, async (req, res) => {
    const input = parse(req.body, schemas.dose);
    const result = await doses.record(req.auth.profileId, req.auth.member, input);
    res.status(result.unchanged ? 200 : 201).json(result);
  });

  router.get('/doses', read, async (req, res) => {
    const to = req.query.to === undefined ? undefined : isoDateQuery(req.query.to, 'to');
    const from = req.query.from === undefined ? undefined : isoDateQuery(req.query.from, 'from');
    const today = (await doses.today(req.auth.profileId)).date;
    const end = to ?? today;
    const start = from ?? addDays(end, -6);
    if (start > end) throw new HttpError(400, 'from must be before to', 'VALIDATION');
    if (addDays(start, 92) < end) throw new HttpError(400, 'Choose a range of at most 92 days', 'VALIDATION');
    res.json({ from: start, to: end, doses: await doses.history(req.auth.profileId, { from: start, to: end }) });
  });

  router.get('/adherence', read, async (req, res) => {
    const days = intQuery(req.query.days, { fallback: 7, min: 1, max: 90, name: 'days' });
    res.json(await doses.adherence(req.auth.profileId, { days }));
  });

  // ---------- Appointments ----------
  router.get('/appointments', read, async (req, res) => {
    const when = req.query.when ?? 'upcoming';
    if (!['upcoming', 'past', 'all'].includes(when)) throw new HttpError(400, 'when must be upcoming, past or all', 'VALIDATION');
    res.json({ appointments: await appointments.list(req.auth.profileId, { when }) });
  });

  router.get('/appointments/:id', read, async (req, res) => {
    res.json({ appointment: await appointments.get(req.auth.profileId, req.params.id) });
  });

  router.post('/appointments', propose, async (req, res) => {
    const data = parse(req.body, appointmentFields);
    sendOutcome(res, await appointments.proposeCreate(req.auth.profileId, req.auth.member, data));
  });

  router.patch('/appointments/:id', propose, async (req, res) => {
    const patch = parse(req.body, appointmentFields, { partial: true });
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to change', 'VALIDATION');
    sendOutcome(res, await appointments.proposeUpdate(req.auth.profileId, req.auth.member, req.params.id, patch));
  });

  router.delete('/appointments/:id', propose, async (req, res) => {
    sendOutcome(res, await appointments.proposeCancel(req.auth.profileId, req.auth.member, req.params.id));
  });

  router.post('/appointments/:id/attended', record, async (req, res) => {
    const { notes } = parse(req.body ?? {}, schemas.attended);
    res.json({ appointment: await appointments.markAttended(req.auth.profileId, req.auth.member, req.params.id, notes) });
  });

  // ---------- Health readings ----------
  router.get('/readings', read, async (req, res) => {
    const type = req.query.type;
    if (type !== undefined && !READING_TYPES[type]) throw new HttpError(400, 'Unknown reading type', 'VALIDATION');
    const days = intQuery(req.query.days, { fallback: 30, min: 1, max: 365, name: 'days' });
    res.json(await readings.list(req.auth.profileId, { type, days }));
  });

  router.post('/readings', record, async (req, res) => {
    const input = parse(req.body, schemas.reading);
    res.status(201).json({ reading: await readings.add(req.auth.profileId, req.auth.member, input) });
  });

  router.delete('/readings/:id', record, async (req, res) => {
    await readings.remove(req.auth.profileId, req.auth.member, req.params.id);
    res.status(204).end();
  });

  return router;
}

function isoDateQuery(value, name) {
  try {
    return isoDate()(value);
  } catch {
    throw new HttpError(400, `${name} must be a date like 2026-11-15`, 'VALIDATION');
  }
}
