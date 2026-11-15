import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import {
  buildTestServices,
  silentLogger,
  seedFamily,
  addMedication,
  createClock,
} from './helpers.js';

let server;
let root;
let ctx;

before(async () => {
  // 07:50 India: the 08:00 dose reminder is due.
  ctx = buildTestServices({ clock: createClock(Date.parse('2026-11-15T02:20:00Z')) });
  const app = createApp({ config: ctx.config, logger: silentLogger(), services: ctx.services });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  root = `http://127.0.0.1:${server.address().port}`;
  ctx.fam = await seedFamily(ctx.services);
  // Created slightly earlier so the 08:00 dose counts.
  ctx.med = await addMedication(ctx.services, ctx.fam.pid, ctx.fam.elder);
});

after(() => new Promise((resolve) => server.close(resolve)));

const runReminders = (secret) =>
  fetch(`${root}/internal/reminders/run`, {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });

test('the scheduler endpoint needs the secret', async () => {
  assert.equal((await runReminders()).status, 401);
  assert.equal((await runReminders('wrong-secret-wrong-secret')).status, 401);
  const ok = await runReminders(ctx.config.cronSecret);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.profiles, 1);
  assert.ok(body.sent >= 1);
});

test('one-tap email link: GET only asks, POST records the dose', async () => {
  const mail = ctx.email.outbox.find(
    (m) => m.to === 'kamala@example.com' && m.subject.startsWith('Time for'),
  );
  assert.ok(mail, 'reminder email was sent');
  const url = mail.text.match(/https:\/\/care\.example(\/a\/\S+)/)[1];

  const confirm = await fetch(`${root}${url}`);
  assert.equal(confirm.status, 200);
  const html = await confirm.text();
  assert.match(html, /Mark Metformin 500 mg as taken\?/);
  assert.match(html, /<form method="post"/);
  assert.equal(confirm.headers.get('cache-control'), 'no-store');
  let today = await ctx.services.doses.today(ctx.fam.pid);
  assert.equal(today.doses[0].record, null, 'opening the link does not log anything');

  const done = await fetch(`${root}${url}`, { method: 'POST' });
  assert.equal(done.status, 200);
  assert.match(await done.text(), /is marked as taken/);
  today = await ctx.services.doses.today(ctx.fam.pid);
  assert.equal(today.doses[0].record.status, 'taken');
  assert.equal(today.doses[0].record.via, 'email');
});

test('an action link is not accepted as a session token', async () => {
  const mail = ctx.email.outbox.find((m) => m.to === 'kamala@example.com');
  const token = mail.text.match(/\/a\/(\S+)/)[1];
  const res = await fetch(`${root}/api/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 401);
});

test('a broken link shows a friendly expired page', async () => {
  const res = await fetch(`${root}/a/not-a-real-token`);
  assert.equal(res.status, 410);
  assert.match(await res.text(), /This link has expired/);
});

test('members can send themselves a test email and see notification history', async () => {
  const login = await fetch(`${root}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileCode: ctx.fam.pid, passcode: 'riya-secret-7' }),
  }).then((r) => r.json());
  const auth = { authorization: `Bearer ${login.token}` };
  const sent = await fetch(`${root}/api/notifications/test`, { method: 'POST', headers: auth });
  assert.equal(sent.status, 200);
  assert.ok(
    ctx.email.outbox.some(
      (m) => m.subject === 'CareCircle test message' && m.to === 'riya@example.com',
    ),
  );
  const history = await fetch(`${root}/api/notifications`, { headers: auth }).then((r) => r.json());
  assert.ok(history.notifications.some((n) => n.kind === 'dose_upcoming'));
});
