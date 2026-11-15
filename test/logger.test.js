import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/lib/logger.js';

const capture = (level) => {
  const lines = [];
  return { lines, logger: createLogger({ level, sink: (l) => lines.push(JSON.parse(l)) }) };
};

test('emits Cloud Logging severity and message fields', () => {
  const { lines, logger } = capture('info');
  logger.info('hello', { a: 1 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].severity, 'INFO');
  assert.equal(lines[0].message, 'hello');
  assert.equal(lines[0].a, 1);
});

test('filters below the configured level', () => {
  const { lines, logger } = capture('warn');
  logger.info('skip');
  logger.debug('skip');
  logger.warn('keep');
  assert.deepEqual(
    lines.map((l) => l.severity),
    ['WARNING'],
  );
});

test('adds stack_trace for Error Reporting', () => {
  const { lines, logger } = capture('info');
  logger.error('boom', { err: new Error('bad') });
  assert.equal(lines[0].severity, 'ERROR');
  assert.match(lines[0].stack_trace, /Error: bad/);
  assert.equal(lines[0].err.message, 'bad');
});
