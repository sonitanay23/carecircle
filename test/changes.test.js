import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestServices, seedFamily } from './helpers.js';

const card = { bloodGroup: 'B+', allergies: ['Penicillin'], conditions: [], emergencyContacts: [], notes: '' };

test("family edits wait for the elder's approval", async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);

  const outcome = await services.medicalId.propose(pid, family, card);
  assert.equal(outcome.status, 'pending');
  assert.equal((await services.medicalId.get(pid)).bloodGroup, 'unknown', 'not applied yet');

  const pending = await services.changes.list(pid, { status: 'pending' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].proposedBy.name, 'Riya');

  await services.changes.approve(pid, elder, outcome.change.id);
  assert.equal((await services.medicalId.get(pid)).bloodGroup, 'B+');
  await assert.rejects(services.changes.approve(pid, elder, outcome.change.id), (e) => e.status === 409);

  const log = await services.activity.list(pid);
  assert.match(log[0].summary, /Kamala Devi approved Riya's change/);
});

test("the elder's own edits apply immediately", async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  const outcome = await services.medicalId.propose(pid, elder, card);
  assert.equal(outcome.status, 'applied');
  assert.equal((await services.medicalId.get(pid)).allergies[0], 'Penicillin');
});

test('rejecting keeps the record unchanged and logs the reason', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  const { change } = await services.medicalId.propose(pid, family, card);
  const rejected = await services.changes.reject(pid, elder, change.id, 'Wrong blood group');
  assert.equal(rejected.status, 'rejected');
  assert.equal((await services.medicalId.get(pid)).bloodGroup, 'unknown');
  assert.match((await services.activity.list(pid))[0].summary, /Wrong blood group/);
});

test('only the proposer can withdraw a pending change', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  const { change } = await services.medicalId.propose(pid, family, card);
  await assert.rejects(services.changes.withdraw(pid, elder, change.id), (e) => e.status === 403);
  assert.equal((await services.changes.withdraw(pid, family, change.id)).status, 'withdrawn');
});

test('the elder can turn approval off so family edits apply directly', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  await services.profiles.updateProfile(pid, elder, { requireApproval: false });
  const outcome = await services.medicalId.propose(pid, family, card);
  assert.equal(outcome.status, 'applied');
  const log = await services.activity.list(pid);
  assert.match(log[0].summary, /^Riya: updated the medical ID card/);
});
