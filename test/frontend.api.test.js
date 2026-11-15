import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { buildTestServices, silentLogger, seedFamily } from './helpers.js';

let server;
let root;
let ctx;

before(async () => {
  ctx = buildTestServices();
  const app = createApp({ config: ctx.config, logger: silentLogger(), services: ctx.services });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  root = `http://127.0.0.1:${server.address().port}`;
  ctx.fam = await seedFamily(ctx.services);
});

after(() => new Promise((resolve) => server.close(resolve)));

test('the app shell loads its module script under a strict CSP', async () => {
  const res = await fetch(`${root}/`);
  const html = await res.text();
  assert.match(html, /<script type="module" src="\/js\/app.js"><\/script>/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline scripts');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /media-src 'self' blob:/);
  assert.match(csp, /worker-src 'self'/);
  for (const path of ['/js/app.js', '/js/views/today.js', '/styles.css', '/icons/icon-192.png']) {
    assert.equal((await fetch(`${root}${path}`)).status, 200, path);
  }
});

test('service worker is never cached and the manifest has the right type', async () => {
  const sw = await fetch(`${root}/sw.js`);
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  const manifest = await fetch(`${root}/manifest.webmanifest`);
  assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
  const body = await manifest.json();
  assert.equal(body.start_url, '/#/today');
  assert.ok(body.icons.some((i) => i.purpose === 'maskable'));
});

test('invite links open the join screen with a cleaned code', async () => {
  const res = await fetch(`${root}/join?profile=AB2C-D3EF%22%3E%3Cscript%3E`, {
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/join?profile=AB2C-D3EFscr');
});

test('the public medical ID page is served but not cached or indexed', async () => {
  const res = await fetch(`${root}/id/some-token-value-here-12345`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Medical ID — CareCircle/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
});

test('QR code endpoint: needs sign-in and sharing turned on', async () => {
  const login = await fetch(`${root}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileCode: ctx.fam.pid, passcode: 'mango-tree-42' }),
  }).then((r) => r.json());
  const auth = { authorization: `Bearer ${login.token}` };
  assert.equal((await fetch(`${root}/api/medical-id/qr.svg`)).status, 401);
  assert.equal(
    (await fetch(`${root}/api/medical-id/qr.svg`, { headers: auth })).status,
    404,
    'sharing is off',
  );
  await fetch(`${root}/api/medical-id/sharing`, { method: 'POST', headers: auth });
  const qr = await fetch(`${root}/api/medical-id/qr.svg`, { headers: auth });
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.match(await qr.text(), /aria-label="QR code for the medical ID link"/);
});

test('oversized uploads get a plain-language message', async () => {
  const login = await fetch(`${root}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileCode: ctx.fam.pid, passcode: 'mango-tree-42' }),
  }).then((r) => r.json());
  const res = await fetch(`${root}/api/medications/x/photo`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${login.token}`, 'content-type': 'image/jpeg' },
    body: Buffer.alloc(600 * 1024),
  });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.equal(body.error.code, 'TOO_LARGE');
  assert.match(body.error.message, /too large/);
});
