import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestServices, seedFamily, addMedication } from './helpers.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('the elder adds a medicine directly; times are sorted', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);
  assert.deepEqual(med.schedule.times, ['08:00', '20:00']);
  assert.equal(med.status, 'active');
  assert.deepEqual(med.supply, { count: 20, perDose: 1, lowAtDays: 5, daysLeft: 10, low: false });
});

test("family adds, changes and stops medicines only with the elder's OK", async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);

  const add = await services.medications.proposeCreate(pid, family, { name: 'Amlodipine', dose: '5 mg', schedule: { times: ['09:00'], startDate: '2026-11-15' } });
  assert.equal(add.status, 'pending');
  assert.equal((await services.medications.list(pid)).length, 0);
  await services.changes.approve(pid, elder, add.change.id);
  const [med] = await services.medications.list(pid);
  assert.equal(med.name, 'Amlodipine');

  const change = await services.medications.proposeUpdate(pid, family, med.id, { schedule: { times: ['21:00'], startDate: '2026-11-15' } });
  assert.equal(change.status, 'pending');
  assert.match(change.change.summary, /now 21:00/);
  await services.changes.approve(pid, elder, change.change.id);
  assert.deepEqual((await services.medications.get(pid, med.id)).schedule.times, ['21:00']);

  const stop = await services.medications.proposeStop(pid, family, med.id);
  await services.changes.approve(pid, elder, stop.change.id);
  assert.equal((await services.medications.list(pid)).length, 0);
  const [stopped] = await services.medications.list(pid, { includeStopped: true });
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.stoppedOn, '2026-11-15');
});

test('approving a change to a medicine that was stopped meanwhile fails cleanly', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);
  const pending = await services.medications.proposeUpdate(pid, family, med.id, { dose: '1000 mg' });
  await services.medications.proposeStop(pid, elder, med.id);
  await assert.rejects(services.changes.approve(pid, elder, pending.change.id), (e) => e.status === 409);
  assert.equal((await services.changes.get(pid, pending.change.id)).status, 'failed');
});

test('a medicine needs a time unless it is "when needed"', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  await assert.rejects(services.medications.proposeCreate(pid, elder, { name: 'X' }), (e) => e.status === 400);
  const prn = await services.medications.proposeCreate(pid, elder, { name: 'Paracetamol', asNeeded: true });
  assert.equal(prn.status, 'applied');
  await assert.rejects(
    services.medications.proposeCreate(pid, elder, { name: 'Y', schedule: { times: ['08:00'], startDate: '2026-11-15', endDate: '2026-11-01' } }),
    /end date/,
  );
});

test('refills add to the count and are logged', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);
  const updated = await services.medications.refill(pid, family, med.id, 30);
  assert.equal(updated.supply.count, 50);
  assert.match((await services.activity.list(pid))[0].summary, /Riya added 30 to Metformin 500 mg \(now 50\)/);
});

test('pill photos: stored, checked by file signature and size', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  const med = await addMedication(services, pid, elder);
  await services.medications.setPhoto(pid, elder, med.id, 'image/png', PNG);
  const photo = await services.medications.getPhoto(pid, med.id);
  assert.deepEqual(photo.buffer, PNG);
  assert.equal((await services.medications.list(pid))[0].hasPhoto, true);

  await assert.rejects(services.medications.setPhoto(pid, elder, med.id, 'image/jpeg', PNG), (e) => e.status === 415);
  await assert.rejects(services.medications.setPhoto(pid, elder, med.id, 'image/gif', PNG), (e) => e.status === 415);
  const huge = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
  await assert.rejects(services.medications.setPhoto(pid, elder, med.id, 'image/png', huge), (e) => e.status === 413);

  await services.medications.deletePhoto(pid, elder, med.id);
  await assert.rejects(services.medications.getPhoto(pid, med.id), (e) => e.status === 404);
});

test('current medicines appear on the public medical ID', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  await addMedication(services, pid, elder);
  const token = (await services.medicalId.enableSharing(pid, elder)).sharing.url.split('/').pop();
  const card = await services.medicalId.publicView(token, services.profiles);
  assert.deepEqual(card.medications, [{ name: 'Metformin', dose: '500 mg', instructions: 'After food' }]);
});
