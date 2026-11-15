import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestServices, seedFamily, addMedication, createClock } from './helpers.js';

const MIN = 60_000;
// 07:40 in India on Sunday 15 Nov 2026.
const start = () => createClock(Date.parse('2026-11-15T02:10:00Z'));

async function setup({ clock = start(), stock } = {}) {
  const ctx = buildTestServices({ clock });
  const { services } = ctx;
  const fam = await seedFamily(services);
  const { inviteCode } = await services.profiles.invite(fam.pid, fam.elder, { name: 'Suresh', role: 'caretaker' });
  const { member: carer } = await services.profiles.join({
    profileCode: fam.pid, inviteCode, passcode: 'suresh-care-9', email: 'suresh@example.com', timezone: 'Asia/Kolkata', language: 'en',
  });
  const med = await addMedication(services, fam.pid, fam.elder, stock ? { stock } : {});
  return { ...ctx, ...fam, carer, med };
}

const to = (email) => email.outbox.map((m) => m.to).sort();
const run = (services) => services.reminders.runAll();

test('dose reminder goes to the elder and caretaker, once', async () => {
  const { services, clock, email } = await setup();
  clock.advance(10 * MIN); // 07:50, 10 minutes before the 08:00 dose
  await run(services);
  assert.deepEqual(to(email), ['kamala@example.com', 'suresh@example.com']);
  const elderMail = email.outbox.find((m) => m.to === 'kamala@example.com');
  assert.equal(elderMail.subject, 'Time for Metformin 500 mg');
  assert.match(elderMail.text, /After food/);
  assert.match(elderMail.html, /I&#39;ve taken it/);
  assert.match(elderMail.html, /<html lang="en">/);

  await run(services);
  assert.equal(email.outbox.length, 2, 'running again sends nothing new');
});

test('missed → elder and caretaker; still missed → family, in their own time zone', async () => {
  const { services, clock, email, pid } = await setup();
  clock.advance(81 * MIN); // 09:01, past the 60-minute missed window
  const first = await run(services);
  assert.equal(first.markedMissed, 1);
  assert.deepEqual(to(email), ['kamala@example.com', 'suresh@example.com']);
  assert.match(email.outbox[0].subject, /missed|Did you take/);
  assert.equal((await services.doses.today(pid)).doses[0].record.status, 'missed');

  email.outbox.length = 0;
  clock.advance(60 * MIN); // 10:01, an hour later and still not taken
  await run(services);
  assert.deepEqual(to(email), ['riya@example.com']);
  const [alert] = email.outbox;
  assert.match(alert.subject, /Please check on Kamala/);
  assert.match(alert.text, /your time/, 'Riya is in Los Angeles');
  assert.match(alert.text, /for Kamala/);
});

test('taking the dose late stops the family alert', async () => {
  const { services, clock, email, pid, elder, med } = await setup();
  clock.advance(81 * MIN);
  await run(services);
  await services.doses.record(pid, elder, { medicationId: med.id, date: '2026-11-15', time: '08:00', status: 'taken' });
  email.outbox.length = 0;
  clock.advance(60 * MIN);
  await run(services);
  assert.equal(email.outbox.filter((m) => m.to === 'riya@example.com').length, 0);
});

test('old doses are marked missed silently (no flood on first run)', async () => {
  const clock = createClock(Date.parse('2026-11-15T02:10:00Z'));
  const ctx = await setup({ clock });
  // Pretend the medicine was added long ago, then jump two days ahead.
  await ctx.services.store.collection(`profiles/${ctx.pid}/medications`).update(ctx.med.id, { createdAt: '2026-11-01T00:00:00.000Z' });
  clock.advance(48 * 60 * MIN);
  const res = await run(ctx.services);
  assert.ok(res.markedMissed >= 2);
  const doseMails = ctx.email.outbox.filter((m) => /Metformin/.test(m.subject) && !/Running low/.test(m.subject));
  // Only doses inside the 12-hour look-back window alert.
  assert.ok(doseMails.length <= 4, `got ${doseMails.length}`);
});

test('a failed email is retried on the next run', async () => {
  const { services, clock, email } = await setup();
  clock.advance(10 * MIN);
  email.failNext = 2; // both recipients fail
  const r1 = await run(services);
  assert.equal(r1.sent, 0);
  await run(services);
  assert.equal(email.outbox.length, 2);
});

test('appointments: day-before and 2-hours-before reminders to everyone', async () => {
  const { services, clock, email, pid, elder } = await setup();
  await services.appointments.proposeCreate(pid, elder, {
    title: 'Eye check-up', doctor: 'Dr Rao', date: '2026-11-16', time: '07:00', location: { name: 'LV Prasad', address: 'Banjara Hills, Hyderabad' },
  });
  clock.advance(10 * MIN);
  email.outbox.length = 0;
  await run(services);
  const dayBefore = email.outbox.filter((m) => m.subject.startsWith('Tomorrow'));
  assert.equal(dayBefore.length, 3, 'elder, family and caretaker');
  assert.match(dayBefore[0].html, /Get directions/);

  clock.advance(22 * 60 * MIN); // 05:50 next day, appointment at 07:00
  email.outbox.length = 0;
  await run(services);
  assert.equal(email.outbox.filter((m) => m.subject.startsWith('Soon')).length, 3);
});

test('low stock alerts once, and again after the next refill runs low', async () => {
  const { services, clock, email, pid, family, med } = await setup({ stock: { count: 4, perDose: 1, lowAtDays: 5 } });
  await run(services);
  assert.equal(email.outbox.filter((m) => m.subject.startsWith('Running low')).length, 3);
  await run(services);
  assert.equal(email.outbox.filter((m) => m.subject.startsWith('Running low')).length, 3, 'not repeated');

  await services.medications.refill(pid, family, med.id, 1); // still low after refill
  clock.advance(MIN);
  await run(services);
  assert.equal(email.outbox.filter((m) => m.subject.startsWith('Running low')).length, 6);
});

test('the elder is asked about suggested changes', async () => {
  const { services, email, pid, family } = await setup();
  await services.medications.proposeCreate(pid, family, { name: 'Amlodipine', dose: '5 mg', schedule: { times: ['21:00'], startDate: '2026-11-15' } });
  await run(services);
  const asks = email.outbox.filter((m) => m.subject === 'Riya suggested a change');
  assert.equal(asks.length, 1);
  assert.equal(asks[0].to, 'kamala@example.com');
  assert.match(asks[0].text, /Nothing changes until you say yes/);
});

test('weekly summary goes out on Sunday evening', async () => {
  const { services, clock, email, pid, elder, med } = await setup();
  clock.advance(25 * MIN); // 08:05
  await services.doses.record(pid, elder, { medicationId: med.id, date: '2026-11-15', time: '08:00', status: 'taken' });
  clock.advance(10 * 60 * MIN); // 18:05 India, Sunday
  email.outbox.length = 0;
  await run(services);
  const weekly = email.outbox.filter((m) => m.subject.startsWith('Weekly summary'));
  assert.equal(weekly.length, 3);
  assert.match(weekly[0].subject, /100%/);
});

test('one-tap action links resolve, cannot be used as sessions, and stop working when access is removed', async () => {
  const { services, clock, email, pid, elder, carer } = await setup();
  clock.advance(10 * MIN);
  await run(services);
  const link = email.outbox.find((m) => m.to === 'suresh@example.com').text.match(/https:\/\/care\.example\/a\/(\S+)/)[1];
  const action = await services.reminders.resolveAction(link);
  assert.equal(action.member.id, carer.id);
  assert.equal(action.time, '08:00');

  const claims = services.tokens.verify(link);
  assert.equal(claims.typ, 'action', 'typed, so the session check refuses it');

  await services.profiles.removeMember(pid, elder, carer.id);
  assert.equal(await services.reminders.resolveAction(link), null);
  assert.equal(await services.reminders.resolveAction('garbage'), null);
});

test('people who turned email off are not emailed', async () => {
  const { services, clock, email, pid, carer } = await setup();
  await services.profiles.updateSelf(pid, carer, { notify: { email: false } });
  clock.advance(10 * MIN);
  await run(services);
  assert.deepEqual(to(email), ['kamala@example.com']);
});

test('notification history records who was told', async () => {
  const { services, clock, pid } = await setup();
  clock.advance(10 * MIN);
  await run(services);
  const [n] = await services.notifier.history(pid);
  assert.equal(n.kind, 'dose_upcoming');
  assert.equal(n.status, 'sent');
  assert.deepEqual(n.deliveries.map((d) => d.name).sort(), ['Kamala Devi', 'Suresh']);
});
