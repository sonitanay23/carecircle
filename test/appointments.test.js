import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestServices, seedFamily, createClock } from './helpers.js';

const visit = {
  title: 'Eye check-up',
  doctor: 'Dr Rao',
  date: '2026-11-20',
  time: '10:30',
  durationMinutes: 45,
  location: { name: 'LV Prasad Eye Institute', address: 'Banjara Hills, Hyderabad' },
};

test('booking needs approval and comes with Calendar and Maps links', async () => {
  const { services } = buildTestServices();
  const { pid, elder, family } = await seedFamily(services);
  const proposed = await services.appointments.proposeCreate(pid, family, visit);
  assert.equal(proposed.status, 'pending');
  await services.changes.approve(pid, elder, proposed.change.id);

  const [appt] = await services.appointments.list(pid);
  assert.equal(appt.startsAt, '2026-11-20T05:00:00.000Z', '10:30 India time');
  assert.equal(appt.endsAt, '2026-11-20T05:45:00.000Z');
  const cal = new URL(appt.links.googleCalendar);
  assert.equal(cal.searchParams.get('text'), 'Eye check-up (Kamala Devi)');
  assert.match(cal.searchParams.get('details'), /Dr Rao/);
  assert.match(appt.links.directions, /^https:\/\/www\.google\.com\/maps\/dir\//);
  assert.equal(
    new URL(appt.links.nearbyPharmacies).searchParams.get('query'),
    'pharmacy near Banjara Hills, Hyderabad',
  );
});

test('appointments in the past are refused', async () => {
  const { services } = buildTestServices();
  const { pid, elder } = await seedFamily(services);
  await assert.rejects(
    services.appointments.proposeCreate(pid, elder, { ...visit, date: '2026-11-01' }),
    (e) => e.code === 'IN_PAST',
  );
});

test('reschedule, cancel and attended move between lists', async () => {
  const clock = createClock();
  const { services } = buildTestServices({ clock });
  const { pid, elder } = await seedFamily(services);
  const { change } = await services.appointments.proposeCreate(pid, elder, visit);
  const id = change.targetId;

  await services.appointments.proposeUpdate(pid, elder, id, { time: '11:00' });
  assert.equal((await services.appointments.get(pid, id)).startsAt, '2026-11-20T05:30:00.000Z');

  await services.appointments.markAttended(pid, elder, id, 'New glasses prescribed');
  assert.equal((await services.appointments.list(pid)).length, 0);
  assert.equal(
    (await services.appointments.list(pid, { when: 'past' }))[0].visitNotes,
    'New glasses prescribed',
  );
  await assert.rejects(
    services.appointments.proposeCancel(pid, elder, id),
    (e) => e.status === 409,
  );

  const second = await services.appointments.proposeCreate(pid, elder, {
    ...visit,
    date: '2026-12-01',
  });
  await services.appointments.proposeCancel(pid, elder, second.change.targetId);
  assert.equal((await services.appointments.list(pid)).length, 0);
  assert.equal((await services.appointments.list(pid, { when: 'all' })).length, 2);
});
