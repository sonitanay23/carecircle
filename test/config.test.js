import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loadConfig applies safe defaults', () => {
  const c = loadConfig({});
  assert.equal(c.port, 8080);
  assert.equal(c.logLevel, 'info');
  assert.equal(c.isProduction, false);
  assert.ok(Object.isFrozen(c));
});

test('loadConfig reads production settings', () => {
  const c = loadConfig({
    PORT: '3000',
    NODE_ENV: 'production',
    LOG_LEVEL: 'WARN',
    K_REVISION: 'rev-1',
    SESSION_SECRET: 'p'.repeat(32),
    APP_BASE_URL: 'https://care.example/',
  });
  assert.equal(c.port, 3000);
  assert.equal(c.isProduction, true);
  assert.equal(c.store, 'firestore', 'production defaults to Firestore');
  assert.equal(c.appBaseUrl, 'https://care.example', 'trailing slash removed');
  assert.equal(c.logLevel, 'warn');
  assert.equal(c.version, 'rev-1');
});

test('loadConfig rejects invalid values', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'loud' }), /Invalid LOG_LEVEL/);
});

test('production refuses to start without a strong session secret', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /SESSION_SECRET/);
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' }),
    /SESSION_SECRET/,
  );
  assert.throws(() => loadConfig({ STORE: 'redis' }), /Invalid STORE/);
});

test('development generates a random session secret and uses memory storage', () => {
  const a = loadConfig({});
  const b = loadConfig({});
  assert.equal(a.store, 'memory');
  assert.ok(a.sessionSecret.length >= 32);
  assert.notEqual(a.sessionSecret, b.sessionSecret);
});
