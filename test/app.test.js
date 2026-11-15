import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { buildTestServices, silentLogger } from './helpers.js';

let server;
let base;

before(async () => {
  const { services, config } = buildTestServices();
  const app = createApp({ config, logger: silentLogger(), services });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('GET /healthz returns ok', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('sets security headers and hides the framework', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.ok(res.headers.get('x-request-id'));
});

test('serves the accessible home page', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Skip to main content/);
});

test('unknown API routes ask for sign-in first, so routes cannot be discovered', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHENTICATED');
  assert.ok(body.error.requestId);
  assert.equal(body.error.stack, undefined);
});

test('unknown pages return a JSON 404', async () => {
  const res = await fetch(`${base}/no-such-page`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});

test('malformed JSON returns 400, not 500', async () => {
  const res = await fetch(`${base}/api/anything`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
  assert.equal(res.status, 400);
});

test('rejects unsafe incoming request ids', async () => {
  const res = await fetch(`${base}/healthz`, { headers: { 'x-request-id': '<script>' } });
  assert.notEqual(res.headers.get('x-request-id'), '<script>');
});
