import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { buildTestServices, silentLogger, elderInput } from './helpers.js';

let server;
let base;

before(async () => {
  const { services, config } = buildTestServices();
  const app = createApp({ config, logger: silentLogger(), services });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
};

const createElder = async () => {
  const res = await call('POST', '/profiles', { body: elderInput() });
  assert.equal(res.status, 201);
  return res.body;
};

const addFamily = async (
  elder,
  { name = 'Riya', role = 'family', passcode = 'riya-secret-7' } = {},
) => {
  const invite = await call('POST', '/members/invites', {
    token: elder.token,
    body: { name, role },
  });
  assert.equal(invite.status, 201);
  const joined = await call('POST', '/members/join', {
    body: {
      profileCode: invite.body.profileCode,
      inviteCode: invite.body.inviteCode,
      passcode,
      email: `${name.toLowerCase()}@example.com`,
      timezone: 'America/Los_Angeles',
      language: 'en',
    },
  });
  assert.equal(joined.status, 201);
  return joined.body;
};

test('sign up, sign in and view my profile', async () => {
  const elder = await createElder();
  assert.match(elder.profile.code, /^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  assert.equal(elder.me.role, 'elder');
  assert.equal(elder.me.passcodeHash, undefined, 'hash never leaves the server');

  const login = await call('POST', '/sessions', {
    body: { profileCode: elder.profile.code, passcode: 'mango-tree-42' },
  });
  assert.equal(login.status, 200);
  const me = await call('GET', '/me', { token: login.body.token });
  assert.equal(me.body.me.name, 'Kamala Devi');
});

test('requests without a valid session are refused', async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', { token: 'forged.token' })).status, 401);
});

test('invalid input returns a clear 400', async () => {
  const res = await call('POST', '/profiles', {
    body: { elderName: '', email: 'bad', timezone: 'Nowhere', language: 'xx', passcode: 'a' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION');
  assert.match(res.body.error.message, /email/);
});

test('family cannot manage members or review changes', async () => {
  const elder = await createElder();
  const family = await addFamily(elder);
  assert.equal(
    (
      await call('POST', '/members/invites', {
        token: family.token,
        body: { name: 'X', role: 'family' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call('PATCH', '/profile', { token: family.token, body: { requireApproval: false } }))
      .status,
    403,
  );
  assert.equal((await call('POST', '/medical-id/sharing', { token: family.token })).status, 403);
});

test('full approval flow over HTTP', async () => {
  const elder = await createElder();
  const family = await addFamily(elder);
  const card = { bloodGroup: 'A+', allergies: ['Aspirin'], conditions: [], emergencyContacts: [] };

  const proposed = await call('PUT', '/medical-id', { token: family.token, body: card });
  assert.equal(proposed.status, 202, 'pending changes return 202 Accepted');
  assert.equal(proposed.body.status, 'pending');

  const pending = await call('GET', '/changes?status=pending', { token: elder.token });
  assert.equal(pending.body.changes.length, 1);
  assert.equal(
    (await call('POST', `/changes/${pending.body.changes[0].id}/approve`, { token: family.token }))
      .status,
    403,
  );

  const approved = await call('POST', `/changes/${pending.body.changes[0].id}/approve`, {
    token: elder.token,
  });
  assert.equal(approved.status, 200);
  const id = await call('GET', '/medical-id', { token: family.token });
  assert.equal(id.body.medicalId.bloodGroup, 'A+');

  const log = await call('GET', '/activity?limit=5', { token: family.token });
  assert.match(log.body.activity[0].summary, /approved Riya's change/);
  assert.equal((await call('GET', '/activity?limit=0', { token: family.token })).status, 400);
});

test('removing a member ends their session immediately', async () => {
  const elder = await createElder();
  const family = await addFamily(elder);
  assert.equal((await call('GET', '/me', { token: family.token })).status, 200);
  assert.equal(
    (await call('DELETE', `/members/${family.me.id}`, { token: elder.token })).status,
    204,
  );
  assert.equal((await call('GET', '/me', { token: family.token })).status, 401);
});

test('changing passcode returns a new session and ends the old one', async () => {
  const elder = await createElder();
  const res = await call('POST', '/me/passcode', {
    token: elder.token,
    body: { currentPasscode: 'mango-tree-42', newPasscode: 'new-river-77' },
  });
  assert.equal(res.status, 200);
  assert.equal((await call('GET', '/me', { token: elder.token })).status, 401);
  assert.equal((await call('GET', '/me', { token: res.body.token })).status, 200);
});

test('public medical ID link works without a passcode and is not cached', async () => {
  const elder = await createElder();
  await call('PUT', '/medical-id', {
    token: elder.token,
    body: { bloodGroup: 'O-', allergies: [], conditions: [], emergencyContacts: [] },
  });
  const shared = await call('POST', '/medical-id/sharing', { token: elder.token });
  const token = shared.body.medicalId.sharing.url.split('/').pop();
  const view = await call('GET', `/public/medical-id/${token}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.bloodGroup, 'O-');
  assert.equal(view.headers.get('cache-control'), 'no-store');
  assert.match(view.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await call('GET', '/public/medical-id/not-a-real-token-at-all')).status, 404);
});
