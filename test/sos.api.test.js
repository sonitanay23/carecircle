import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { buildTestServices, silentLogger, seedFamily, elderInput } from './helpers.js';

let server;
let root;
let ctx;

const signIn = async (passcode, profileCode = ctx.fam.pid) => {
  const res = await fetch(`${root}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileCode, passcode }),
  }).then((r) => r.json());
  return { authorization: `Bearer ${res.token}`, 'content-type': 'application/json' };
};

const sos = (headers, body = {}) =>
  fetch(`${root}/api/sos`, { method: 'POST', headers, body: JSON.stringify(body) });

before(async () => {
  ctx = buildTestServices();
  const app = createApp({ config: ctx.config, logger: silentLogger(), services: ctx.services });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  root = `http://127.0.0.1:${server.address().port}`;
  ctx.fam = await seedFamily(ctx.services);
  await ctx.services.profiles.updateSelf(ctx.fam.pid, ctx.fam.elder, { phone: '+919876543210' });
});

after(() => new Promise((resolve) => server.close(resolve)));

test('SOS emails the rest of the circle, with location', async () => {
  const elder = await signIn('mango-tree-42');
  const res = await sos(elder, {
    location: { latitude: 12.9715987, longitude: 77.5945627, accuracyMeters: 18.4 },
    note: 'I fell in the kitchen',
  });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { status: 'sent', sent: 1, failed: 0 });

  const mail = ctx.email.outbox.find((m) => m.subject === 'SOS: Kamala needs help');
  assert.equal(mail.to, 'riya@example.com');
  assert.match(mail.text, /Message: I fell in the kitchen/);
  assert.match(mail.text, /within about 18 m/);
  assert.match(mail.text, /google\.com\/maps\/search\/\?api=1&query=12\.971599%2C77\.594563/);
  assert.match(mail.html, /Open the location in Google Maps/);

  assert.match(mail.text, /SOS from Kamala/);
  assert.match(mail.html, /Call Kamala/);
  assert.ok(
    !ctx.email.outbox.some((m) => m.subject.startsWith('SOS') && m.to === 'kamala@example.com'),
    'not sent back to the sender',
  );

  const activity = await ctx.services.activity.list(ctx.fam.pid);
  assert.ok(activity.some((a) => a.action === 'sos.sent' && /with their location/.test(a.summary)));
});

test('pressing SOS again within a minute does not send a second wave', async () => {
  const elder = await signIn('mango-tree-42');
  const before = ctx.email.outbox.length;
  const res = await sos(elder);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'already_sent');
  assert.equal(ctx.email.outbox.length, before);
});

test('family can raise an SOS for the elder', async () => {
  const riya = await signIn('riya-secret-7');
  const res = await sos(riya);
  assert.equal(res.status, 201);
  const mail = ctx.email.outbox.find(
    (m) => m.to === 'kamala@example.com' && m.subject.startsWith('SOS'),
  );
  assert.match(mail.text, /SOS from Riya \(for Kamala\)/);
  assert.match(mail.text, /No location was shared/);
});

test('SOS validates the location', async () => {
  const elder = await signIn('mango-tree-42');
  const res = await sos(elder, { location: { latitude: 120, longitude: 0 } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /latitude/);
});

test('SOS needs a signed-in member', async () => {
  assert.equal((await sos({ 'content-type': 'application/json' })).status, 401);
});

test('with no one else in the circle, SOS says to call emergency services', async () => {
  const { profile } = await ctx.services.profiles.createProfile(
    elderInput({ elderName: 'Solo Elder', passcode: 'lonely-river-91' }),
  );
  const res = await sos(await signIn('lonely-river-91', profile.id));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error.message, /call your local emergency number/);
});
