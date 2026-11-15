import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestServices, seedFamily } from './helpers.js';

const card = {
  bloodGroup: 'O+',
  allergies: ['Sulfa drugs'],
  conditions: ['Type 2 diabetes'],
  emergencyContacts: [{ name: 'Riya', relation: 'Daughter', phone: '+14155550100' }],
  notes: 'Wears hearing aid',
};

test('sharing creates a working public link that shows only emergency info', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  await services.medicalId.propose(pid, elder, card);
  const { sharing } = await services.medicalId.enableSharing(pid, elder);
  assert.equal(sharing.enabled, true);
  assert.match(sharing.url, /^https:\/\/care\.example\/id\/[\w-]{32}$/);

  const token = sharing.url.split('/').pop();
  const view = await services.medicalId.publicView(token, services.profiles);
  assert.equal(view.name, 'Kamala Devi');
  assert.equal(view.bloodGroup, 'O+');
  assert.equal(view.sharing, undefined, 'link details are not exposed publicly');
  assert.equal(view.share, undefined);
});

test('replacing or turning off the link stops old QR codes working', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  const first = (await services.medicalId.enableSharing(pid, elder)).sharing.url.split('/').pop();
  const second = (await services.medicalId.enableSharing(pid, elder)).sharing.url.split('/').pop();
  assert.notEqual(first, second);
  await assert.rejects(services.medicalId.publicView(first, services.profiles), (e) => e.status === 404);
  await services.medicalId.publicView(second, services.profiles);

  await services.medicalId.disableSharing(pid, elder);
  await assert.rejects(services.medicalId.publicView(second, services.profiles), (e) => e.status === 404);
});

test('views are logged at most once an hour', async () => {
  const { services, clock } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  const token = (await services.medicalId.enableSharing(pid, elder)).sharing.url.split('/').pop();
  await services.medicalId.publicView(token, services.profiles);
  await services.medicalId.publicView(token, services.profiles);
  clock.advance(61 * 60_000);
  await services.medicalId.publicView(token, services.profiles);
  const views = (await services.activity.list(pid)).filter((e) => e.action === 'medicalId.viewed');
  assert.equal(views.length, 2);
});

test('garbage tokens are rejected without a lookup', async () => {
  const { services } = buildTestServices();
  await assert.rejects(services.medicalId.publicView('short', services.profiles), (e) => e.status === 404);
  await assert.rejects(services.medicalId.publicView('x'.repeat(200), services.profiles), (e) => e.status === 404);
});
