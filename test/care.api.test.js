import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { buildTestServices, silentLogger, elderInput, createClock } from './helpers.js';

let server;
let base;

before(async () => {
  // Noon in India on 15 Nov 2026.
  const { services, config } = buildTestServices({
    clock: createClock(Date.parse('2026-11-15T06:30:00Z')),
  });
  const app = createApp({ config, logger: silentLogger(), services });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const call = async (method, path, { token, body, raw, type } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (raw) headers['content-type'] = type;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const ct = res.headers.get('content-type') ?? '';
  const payload = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: payload, headers: res.headers };
};

async function circle() {
  const elder = (await call('POST', '/profiles', { body: elderInput() })).body;
  const invite = (
    await call('POST', '/members/invites', {
      token: elder.token,
      body: { name: 'Riya', role: 'family' },
    })
  ).body;
  const family = (
    await call('POST', '/members/join', {
      body: {
        profileCode: invite.profileCode,
        inviteCode: invite.inviteCode,
        passcode: 'riya-secret-7',
        email: 'riya@example.com',
        timezone: 'America/Los_Angeles',
        language: 'en',
      },
    })
  ).body;
  return { elder, family };
}

const metformin = {
  name: 'Metformin',
  dose: '500 mg',
  form: 'tablet',
  schedule: { times: ['08:00', '20:00'], startDate: '2026-11-01' },
  stock: { count: 6 },
};

test('medicine lifecycle over HTTP: add, today, log a dose, low stock', async () => {
  const { elder, family } = await circle();
  const added = await call('POST', '/medications', { token: elder.token, body: metformin });
  assert.equal(added.status, 200);
  assert.equal(added.body.status, 'applied');

  const suggested = await call('POST', '/medications', {
    token: family.token,
    body: { ...metformin, name: 'Amlodipine' },
  });
  assert.equal(suggested.status, 202, 'family suggestions wait for approval');

  const today = await call('GET', '/doses/today', { token: family.token });
  assert.equal(today.body.doses.length, 2);
  assert.equal(today.body.doses[0].status, 'missed');

  const logged = await call('POST', '/doses', {
    token: family.token,
    body: {
      medicationId: added.body.change.targetId,
      date: '2026-11-15',
      time: '08:00',
      status: 'taken',
    },
  });
  assert.equal(logged.status, 201);
  assert.equal(logged.body.supply.count, 5);
  assert.equal(logged.body.supply.low, true, '5 tablets at 2 a day is 2 days left');

  const again = await call('POST', '/doses', {
    token: elder.token,
    body: {
      medicationId: added.body.change.targetId,
      date: '2026-11-15',
      time: '08:00',
      status: 'taken',
    },
  });
  assert.equal(again.status, 200, 'logging the same dose twice is harmless');

  const adherence = await call('GET', '/adherence?days=7', { token: elder.token });
  assert.equal(adherence.status, 200);
  assert.equal(adherence.body.totals.taken, 1);
});

test('bad medicine input gets a clear message', async () => {
  const { elder } = await circle();
  const res = await call('POST', '/medications', {
    token: elder.token,
    body: { ...metformin, schedule: { times: ['8am'], startDate: '2026-11-01' } },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /08:30/);
  assert.equal(
    (await call('POST', '/medications', { token: elder.token, body: { name: 'X' } })).status,
    400,
  );
  assert.equal(
    (await call('PATCH', '/medications/whatever', { token: elder.token, body: {} })).status,
    400,
  );
});

test('pill photo upload and download', async () => {
  const { elder, family } = await circle();
  const { body } = await call('POST', '/medications', { token: elder.token, body: metformin });
  const id = body.change.targetId;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

  assert.equal(
    (
      await call('PUT', `/medications/${id}/photo`, {
        token: family.token,
        raw: png,
        type: 'image/png',
      })
    ).status,
    204,
  );
  const photo = await call('GET', `/medications/${id}/photo`, { token: elder.token });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');
  assert.deepEqual(photo.body, png);
  assert.match(photo.headers.get('cache-control'), /private/);

  const fake = await call('PUT', `/medications/${id}/photo`, {
    token: elder.token,
    raw: Buffer.from('<svg/>'),
    type: 'image/jpeg',
  });
  assert.equal(fake.status, 415);
  assert.equal((await call('GET', `/medications/${id}/photo`)).status, 401, 'photos need sign-in');
});

test('appointments over HTTP include Google links', async () => {
  const { elder } = await circle();
  const res = await call('POST', '/appointments', {
    token: elder.token,
    body: {
      title: 'Heart check-up',
      date: '2026-11-25',
      time: '09:00',
      location: { name: 'Apollo Hospitals', address: 'Jubilee Hills, Hyderabad' },
    },
  });
  assert.equal(res.status, 200);
  const list = await call('GET', '/appointments', { token: elder.token });
  assert.equal(list.body.appointments.length, 1);
  assert.match(list.body.appointments[0].links.googleCalendar, /^https:\/\/calendar\.google\.com/);
  assert.equal((await call('GET', '/appointments?when=soon', { token: elder.token })).status, 400);
});

test('health readings over HTTP', async () => {
  const { elder, family } = await circle();
  const added = await call('POST', '/readings', {
    token: family.token,
    body: { type: 'bp', systolic: 150, diastolic: 95 },
  });
  assert.equal(added.status, 201);
  assert.equal(added.body.reading.flag, 'discuss_with_doctor');
  const list = await call('GET', '/readings?type=bp&days=7', { token: elder.token });
  assert.equal(list.body.readings.length, 1);
  assert.equal((await call('GET', '/readings?type=mood', { token: elder.token })).status, 400);
  assert.equal(
    (await call('DELETE', `/readings/${added.body.reading.id}`, { token: elder.token })).status,
    204,
  );
});

test('dose history range is validated', async () => {
  const { elder } = await circle();
  assert.equal((await call('GET', '/doses', { token: elder.token })).status, 200);
  assert.equal((await call('GET', '/doses?from=2026-13-01', { token: elder.token })).status, 400);
  assert.equal(
    (await call('GET', '/doses?from=2026-01-01&to=2026-11-15', { token: elder.token })).status,
    400,
  );
  assert.equal((await call('GET', '/adherence?days=500', { token: elder.token })).status, 400);
});
