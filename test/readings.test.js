import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestServices, seedFamily } from './helpers.js';

test('blood pressure readings are stored and flagged for the doctor when high', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  const normal = await services.readings.add(pid, elder, {
    type: 'bp',
    systolic: 122,
    diastolic: 80,
  });
  const high = await services.readings.add(pid, elder, {
    type: 'bp',
    systolic: 152,
    diastolic: 94,
  });
  assert.equal(normal.display, '122/80 mmHg');
  assert.equal(normal.flag, null);
  assert.equal(high.flag, 'discuss_with_doctor');

  const { summary } = await services.readings.list(pid);
  assert.equal(summary[0].count, 2);
  assert.equal(summary[0].flagged, 1);
  assert.deepEqual(summary[0].average, { systolic: 137, diastolic: 87 });
});

test('sugar readings need context; fasting and after-meal use different ranges', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  await assert.rejects(services.readings.add(pid, elder, { type: 'sugar', value: 110 }), /fasting/);
  assert.equal(
    (await services.readings.add(pid, elder, { type: 'sugar', value: 140, context: 'fasting' }))
      .flag,
    'discuss_with_doctor',
  );
  assert.equal(
    (await services.readings.add(pid, elder, { type: 'sugar', value: 140, context: 'after_meal' }))
      .flag,
    null,
  );
});

test('typing mistakes and impossible values are caught', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  await assert.rejects(
    services.readings.add(pid, elder, { type: 'bp', systolic: 1200, diastolic: 80 }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    services.readings.add(pid, elder, { type: 'bp', systolic: 80, diastolic: 120 }),
    /lower number/,
  );
  await assert.rejects(
    services.readings.add(pid, elder, { type: 'spo2', value: 101 }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    services.readings.add(pid, elder, {
      type: 'pulse',
      value: 70,
      takenAt: '2030-01-01T00:00:00.000Z',
    }),
    /future/,
  );
});

test('only the person who logged a reading, or the elder, can delete it', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  const mine = await services.readings.add(pid, elder, { type: 'pulse', value: 72 });
  await assert.rejects(services.readings.remove(pid, family, mine.id), (e) => e.status === 403);
  const theirs = await services.readings.add(pid, family, { type: 'weight', value: 61.5 });
  await services.readings.remove(pid, elder, theirs.id);
  await services.readings.remove(pid, elder, mine.id);
  assert.equal((await services.readings.list(pid)).readings.length, 0);
});
