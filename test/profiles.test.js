import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestServices, elderInput, seedFamily } from './helpers.js';
import { MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES, INVITE_DAYS } from '../src/services/profiles.js';

test('creating a profile makes the elder the owner', async () => {
  const { services } = buildTestServices();
  const { profile, member } = await services.profiles.createProfile(elderInput());
  assert.match(profile.id, /^[2-9A-Z]{8}$/);
  assert.equal(member.role, 'elder');
  assert.equal(profile.elderMemberId, member.id);
  assert.equal(profile.settings.requireApproval, true);
  assert.ok(!JSON.stringify(member).includes('mango-tree-42'), 'passcode is never stored in plain text');
  const log = await services.activity.list(profile.id);
  assert.equal(log[0].action, 'profile.created');
});

test('weak passcodes are refused at sign-up', async () => {
  const { services } = buildTestServices();
  await assert.rejects(services.profiles.createProfile(elderInput({ passcode: '123456' })), (e) => e.status === 400);
});

test('each person signs in with their own passcode', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  const a = await services.profiles.login({ profileCode: pid, passcode: 'mango-tree-42' });
  assert.equal(a.member.id, elder.id);
  const b = await services.profiles.login({ profileCode: `${pid.slice(0, 4)}-${pid.slice(4).toLowerCase()}`, passcode: 'riya-secret-7' });
  assert.equal(b.member.id, family.id);
});

test('wrong passcode and unknown profile give the same message', async () => {
  const { services } = buildTestServices();
  const { pid } = await seedFamily(services);
  const e1 = await services.profiles.login({ profileCode: pid, passcode: 'nope-nope' }).catch((e) => e);
  const e2 = await services.profiles.login({ profileCode: 'ZZZZZZZZ', passcode: 'nope-nope' }).catch((e) => e);
  assert.equal(e1.status, 401);
  assert.equal(e1.message, e2.message);
});

test(`locks sign-in after ${MAX_FAILED_ATTEMPTS} wrong passcodes, then unlocks`, async () => {
  const { services, clock } = buildTestServices();
  const { pid } = await seedFamily(services);
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
    await assert.rejects(services.profiles.login({ profileCode: pid, passcode: 'wrong-guess' }), (e) => e.status === 401);
  }
  // Even the right passcode is refused while locked.
  await assert.rejects(services.profiles.login({ profileCode: pid, passcode: 'mango-tree-42' }), (e) => e.status === 429);
  const log = await services.activity.list(pid);
  assert.ok(log.some((e) => e.action === 'security.locked'));

  clock.advance(LOCKOUT_MINUTES * 60_000 + 1);
  const ok = await services.profiles.login({ profileCode: pid, passcode: 'mango-tree-42' });
  assert.equal(ok.member.role, 'elder');
});

test('invites: single use, expire, and passcodes must be unique', async () => {
  const { services, clock } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  const joinInput = { profileCode: pid, email: 'c@example.com', timezone: 'Asia/Kolkata', language: 'ta' };

  const { inviteCode } = await services.profiles.invite(pid, elder, { name: 'Suresh', role: 'caretaker' });
  await assert.rejects(
    services.profiles.join({ ...joinInput, inviteCode, passcode: 'riya-secret-7' }),
    (e) => e.status === 409 && e.code === 'PASSCODE_TAKEN',
  );
  const { member } = await services.profiles.join({ ...joinInput, inviteCode, passcode: 'suresh-care-9' });
  assert.equal(member.role, 'caretaker');
  assert.equal(member.status, 'active');
  await assert.rejects(services.profiles.join({ ...joinInput, inviteCode, passcode: 'another-one-5' }), (e) => e.status === 401);

  const late = await services.profiles.invite(pid, elder, { name: 'Late', role: 'family' });
  clock.advance(INVITE_DAYS * 86_400_000 + 1);
  await assert.rejects(
    services.profiles.join({ ...joinInput, inviteCode: late.inviteCode, passcode: 'late-comer-3' }),
    (e) => e.status === 410,
  );
});

test('the elder cannot be removed; removed members cannot sign in', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  await assert.rejects(services.profiles.removeMember(pid, elder, elder.id), (e) => e.status === 400);
  await services.profiles.removeMember(pid, elder, family.id);
  await assert.rejects(services.profiles.login({ profileCode: pid, passcode: 'riya-secret-7' }), (e) => e.status === 401);
  const removed = await services.profiles.getMember(pid, family.id);
  assert.equal(removed.tokenVersion, family.tokenVersion + 1, 'existing sessions are revoked');
  assert.equal((await services.profiles.listMembers(pid)).length, 1);
});

test('changing passcode needs the current one and revokes sessions', async () => {
  const { services } = buildTestServices();
  const { pid, family } = await seedFamily(services);
  await assert.rejects(
    services.profiles.changePasscode(pid, family, { currentPasscode: 'bad-guess', newPasscode: 'fresh-code-8' }),
    (e) => e.status === 401,
  );
  const updated = await services.profiles.changePasscode(pid, family, { currentPasscode: 'riya-secret-7', newPasscode: 'fresh-code-8' });
  assert.equal(updated.tokenVersion, family.tokenVersion + 1);
  const { member } = await services.profiles.login({ profileCode: pid, passcode: 'fresh-code-8' });
  assert.equal(member.id, family.id);
});

test('members update their own reminder preferences', async () => {
  const { services } = buildTestServices();
  const { pid, family } = await seedFamily(services);
  const updated = await services.profiles.updateSelf(pid, family, { timezone: 'Europe/London', notify: { email: false } });
  assert.equal(updated.timezone, 'Europe/London');
  assert.deepEqual(updated.notify, { email: false });
});
