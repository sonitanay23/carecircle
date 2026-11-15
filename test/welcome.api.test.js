import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { buildTestServices, silentLogger, elderInput } from './helpers.js';
import { messages } from '../src/notify/messages.js';

let server;
let base;
let email;

before(async () => {
  const built = buildTestServices();
  email = built.email;
  const app = createApp({ config: built.config, logger: silentLogger(), services: built.services });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = async (path, body, token) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

/** The welcome email is sent in the background, so wait for it briefly. */
const waitForMail = async (count) => {
  for (let i = 0; i < 50 && email.outbox.length < count; i += 1) await new Promise((r) => setTimeout(r, 10));
};

test('a new elder gets a welcome email with their CareCircle code', async () => {
  const elder = await post('/profiles', elderInput());
  assert.equal(elder.status, 201);
  await waitForMail(1);
  const mail = email.outbox.find((m) => m.to === elderInput().email);
  assert.ok(mail, 'welcome email sent');
  assert.match(mail.subject, /CareCircle code/);
  assert.ok(mail.text.includes(elder.body.profile.code), 'email includes the code');
  assert.ok(!mail.text.includes(elderInput().passcode), 'passcode is never emailed');
});

test('a family member who joins also gets the code by email', async () => {
  const elder = await post('/profiles', elderInput({ email: 'second@example.com' }));
  const invite = await post('/members/invites', { name: 'Ravi', role: 'family' }, elder.body.token);
  assert.equal(invite.status, 201);
  const before = email.outbox.length;
  const joined = await post('/members/join', {
    profileCode: invite.body.profileCode,
    inviteCode: invite.body.inviteCode,
    passcode: 'river-lamp-42',
    email: 'ravi@example.com',
    timezone: 'Asia/Kolkata',
    language: 'en',
  });
  assert.equal(joined.status, 201);
  await waitForMail(before + 1);
  const mail = email.outbox.find((m) => m.to === 'ravi@example.com');
  assert.ok(mail, 'welcome email sent to the new member');
  assert.ok(mail.text.includes(invite.body.profileCode));
});

test('welcome message wording differs for elder and family', () => {
  const elderMsg = messages.welcome({ recipient: { name: 'Kamala Rao', role: 'elder' }, elderName: 'Kamala Rao', code: 'ABCD-EFGH', appUrl: 'https://x' });
  const familyMsg = messages.welcome({ recipient: { name: 'Ravi', role: 'family' }, elderName: 'Kamala Rao', code: 'ABCD-EFGH', appUrl: 'https://x' });
  assert.match(elderMsg.text, /You stay in charge/);
  assert.match(familyMsg.text, /joined Kamala's CareCircle/);
  assert.match(familyMsg.html, /ABCD-EFGH/);
});
