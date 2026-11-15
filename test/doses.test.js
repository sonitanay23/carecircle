import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestServices, seedFamily, addMedication, createClock } from './helpers.js';

const HOUR = 3_600_000;
// 2026-11-15 06:30 UTC = 12:00 noon in India (Asia/Kolkata).
const noonIndia = () => createClock(Date.parse('2026-11-15T06:30:00Z'));

test("today's doses are in the elder's time zone with live status", async () => {
  const clock = noonIndia();
  const { services } = buildTestServices({ clock });
  const { pid, elder } = await seedFamily(services);
  await addMedication(services, pid, elder);
  const today = await services.doses.today(pid);
  assert.equal(today.date, '2026-11-15');
  assert.deepEqual(
    today.doses.map((d) => [d.time, d.status]),
    [
      ['08:00', 'missed'],
      ['20:00', 'upcoming'],
    ],
  );

  clock.advance(7.75 * HOUR); // 19:45 India: 20:00 dose is due
  assert.equal((await services.doses.today(pid)).doses[1].status, 'due');
});

test('logging a dose updates status and stock, and is idempotent', async () => {
  const clock = noonIndia();
  const { services } = buildTestServices({ clock });
  const { pid, elder, family } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);

  const first = await services.doses.record(pid, family, {
    medicationId: med.id,
    date: '2026-11-15',
    time: '08:00',
    status: 'taken',
  });
  assert.equal(first.dose.status, 'taken');
  assert.equal(first.dose.late, true, '4 hours after the dose is late');
  assert.equal(first.supply.count, 19);

  const again = await services.doses.record(pid, elder, {
    medicationId: med.id,
    date: '2026-11-15',
    time: '08:00',
    status: 'taken',
    via: 'email',
  });
  assert.equal(again.unchanged, true);
  assert.equal((await services.medications.get(pid, med.id)).supply.count, 19, 'no double count');

  const undo = await services.doses.record(pid, elder, {
    medicationId: med.id,
    date: '2026-11-15',
    time: '08:00',
    status: 'skipped',
  });
  assert.equal(undo.supply.count, 20, 'tablet goes back when changed to skipped');
  assert.equal((await services.doses.today(pid)).doses[0].status, 'skipped');
});

test('doses must be on the schedule and not too far in the future', async () => {
  const clock = noonIndia();
  const { services } = buildTestServices({ clock });
  const { pid, elder } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);
  await assert.rejects(
    services.doses.record(pid, elder, {
      medicationId: med.id,
      date: '2026-11-15',
      time: '09:00',
      status: 'taken',
    }),
    (e) => e.code === 'NOT_SCHEDULED',
  );
  await assert.rejects(
    services.doses.record(pid, elder, {
      medicationId: med.id,
      date: '2026-11-15',
      time: '20:00',
      status: 'taken',
    }),
    (e) => e.code === 'TOO_EARLY',
  );
  await assert.rejects(
    services.doses.record(pid, elder, {
      medicationId: 'nope',
      date: '2026-11-15',
      time: '08:00',
      status: 'taken',
    }),
    (e) => e.status === 404,
  );
});

test('"when needed" medicines can be logged any time', async () => {
  const { services } = buildTestServices({ clock: noonIndia() });
  const { pid, elder } = await seedFamily(services);
  const prn = await addMedication(services, pid, elder, {
    name: 'Paracetamol',
    asNeeded: true,
    schedule: undefined,
    stock: { count: 10 },
  });
  const { dose, supply } = await services.doses.record(pid, elder, {
    medicationId: prn.id,
    status: 'taken',
  });
  assert.equal(dose.asNeeded, true);
  assert.equal(supply.count, 9);
  assert.equal((await services.doses.today(pid)).asNeededTaken.length, 1);
  await assert.rejects(
    services.doses.record(pid, elder, { medicationId: prn.id, status: 'skipped' }),
    (e) => e.status === 400,
  );
});

test('markMissed never overwrites a real record', async () => {
  const { services } = buildTestServices({ clock: noonIndia() });
  const { pid, elder } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);
  await services.doses.record(pid, elder, {
    medicationId: med.id,
    date: '2026-11-15',
    time: '08:00',
    status: 'taken',
  });
  const [dose] = (await services.doses.today(pid)).doses;
  const result = await services.doses.markMissed(pid, med, dose);
  assert.equal(result.status, 'taken');
});

test('adherence counts only past doses since the medicine was added, with a streak', async () => {
  // Add the medicine at 07:00 India on 15 Nov, so the 08:00 dose that day counts.
  const clock = createClock(Date.parse('2026-11-15T01:30:00Z'));
  const { services } = buildTestServices({ clock });
  const { pid, elder } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);
  const take = (date, time) =>
    services.doses.record(pid, elder, { medicationId: med.id, date, time, status: 'taken' });

  clock.advance(1.25 * HOUR); // 08:15
  await take('2026-11-15', '08:00');
  clock.advance(12 * HOUR); // 20:15
  await take('2026-11-15', '20:00');
  clock.advance(12 * HOUR); // 16 Nov 08:15 — skip this one
  await services.doses.record(pid, elder, {
    medicationId: med.id,
    date: '2026-11-16',
    time: '08:00',
    status: 'skipped',
  });
  clock.advance(12 * HOUR); // 20:15 — forget this one
  clock.advance(24 * HOUR); // 17 Nov 20:15
  await take('2026-11-17', '08:00');
  await take('2026-11-17', '20:00');
  clock.advance(2 * HOUR); // 17 Nov 22:15, so both doses that day are past their window

  const a = await services.doses.adherence(pid, { days: 7 });
  assert.equal(a.to, '2026-11-17');
  // 15 Nov: 2 of 2 taken. 16 Nov: 1 skipped, 1 missed. 17 Nov: 2 of 2 taken (morning one late).
  assert.deepEqual(a.totals, {
    expected: 6,
    taken: 4,
    skipped: 1,
    missed: 1,
    adherencePercent: 67,
  });
  assert.equal(a.streakDays, 1);
  assert.equal(a.medications[0].late, 1, '17 Nov 08:00 was logged 14 hours late');
  assert.equal(
    a.days.find((d) => d.date === '2026-11-14').expected,
    0,
    'nothing before the medicine was added',
  );
});

test('a dose logged early or from before the medicine was added still counts', async () => {
  const { services } = buildTestServices({ clock: noonIndia() });
  const { pid, elder } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);
  let a = await services.doses.adherence(pid, { days: 1 });
  assert.equal(a.totals.expected, 0, 'the unlogged 08:00 dose was before the medicine was added');
  await services.doses.record(pid, elder, {
    medicationId: med.id,
    date: '2026-11-15',
    time: '08:00',
    status: 'taken',
  });
  a = await services.doses.adherence(pid, { days: 1 });
  assert.deepEqual([a.totals.expected, a.totals.taken], [1, 1]);
});
