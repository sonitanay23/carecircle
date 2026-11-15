import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { buildTestServices, silentLogger, seedFamily, addMedication, createClock, fakeGemini } from './helpers.js';

const servers = [];
async function start(ai) {
  const ctx = buildTestServices({ clock: createClock(Date.parse('2026-11-15T06:30:00Z')), ai });
  const app = createApp({ config: ctx.config, logger: silentLogger(), services: ctx.services });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  const fam = await seedFamily(ctx.services);
  const login = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileCode: fam.pid, passcode: 'mango-tree-42' }),
  }).then((r) => r.json());
  return { ...ctx, ...fam, base: `http://127.0.0.1:${server.address().port}/api`, auth: { authorization: `Bearer ${login.token}` } };
}

let on;
let off;
before(async () => {
  on = await start({
    gemini: fakeGemini({
      prescription: { readable: true, medications: [{ name: 'Atorvastatin', dose: '10 mg', form: 'tablet', times: ['22:00'], asNeeded: false }], warnings: [] },
      Explain: { summary: 'Helps lower cholesterol.', howToTake: 'At night.', commonSideEffects: [], askDoctorIf: [] },
      spoken: { answer: 'Your next dose is at 8 in the evening.', needsDoctor: false },
    }),
    speech: { synthesize: async () => Buffer.from('ID3-fake-mp3') },
    translator: { translate: async (texts, lang) => texts.map((t) => `${lang}:${t}`) },
  });
  off = await start(undefined);
});

after(() => Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve)))));

test('AI status reports what is switched on', async () => {
  assert.deepEqual(
    await fetch(`${on.base}/ai/status`, { headers: on.auth }).then((r) => r.json()),
    { gemini: true, translation: true, readAloud: true, languages: ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur'] },
  );
  const status = await fetch(`${off.base}/ai/status`, { headers: off.auth }).then((r) => r.json());
  assert.equal(status.gemini, false);
  const res = await fetch(`${off.base}/ai/interactions`, { headers: off.auth });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'AI_DISABLED');
});

test('prescription scan over HTTP accepts real images only', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const ok = await fetch(`${on.base}/ai/prescription-scan`, { method: 'POST', headers: { ...on.auth, 'content-type': 'image/jpeg' }, body: jpeg });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.drafts[0].name, 'Atorvastatin');
  assert.deepEqual(body.drafts[0].schedule.times, ['22:00']);

  const fake = await fetch(`${on.base}/ai/prescription-scan`, { method: 'POST', headers: { ...on.auth, 'content-type': 'image/png' }, body: Buffer.from('hello') });
  assert.equal(fake.status, 415);
  const noAuth = await fetch(`${on.base}/ai/prescription-scan`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg });
  assert.equal(noAuth.status, 401);
});

test('explanation, ask and language checks', async () => {
  const med = await addMedication(on.services, on.pid, on.elder);
  const ex = await fetch(`${on.base}/medications/${med.id}/explanation?lang=ta`, { headers: on.auth });
  assert.equal(ex.status, 200);
  assert.equal((await ex.json()).language, 'ta');
  assert.equal((await fetch(`${on.base}/medications/${med.id}/explanation?lang=xx`, { headers: on.auth })).status, 400);

  const ask = await fetch(`${on.base}/ai/ask`, {
    method: 'POST',
    headers: { ...on.auth, 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'When is my next dose?' }),
  });
  assert.equal((await ask.json()).answer, 'Your next dose is at 8 in the evening.');
  const empty = await fetch(`${on.base}/ai/ask`, { method: 'POST', headers: { ...on.auth, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(empty.status, 400);
});

test('read-aloud returns MP3 audio, and translation works', async () => {
  const res = await fetch(`${on.base}/ai/speak`, {
    method: 'POST',
    headers: { ...on.auth, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Time for Metformin', lang: 'hi' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'ID3-fake-mp3');

  const tr = await fetch(`${on.base}/ai/translate`, {
    method: 'POST',
    headers: { ...on.auth, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'After food', lang: 'bn' }),
  }).then((r) => r.json());
  assert.deepEqual(tr, { text: 'bn:After food', lang: 'bn' });

  assert.equal(
    (await fetch(`${off.base}/ai/speak`, { method: 'POST', headers: { ...off.auth, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) })).status,
    503,
  );
});
