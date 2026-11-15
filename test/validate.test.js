import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, string, email, phone, timezone, oneOf, optional, array, object, boolean } from '../src/lib/validate.js';

test('parse cleans values and drops unknown keys', () => {
  const out = parse({ name: '  Asha ', extra: 'x' }, { name: string({ max: 10 }) });
  assert.deepEqual(out, { name: 'Asha' });
});

test('parse reports every problem at once', () => {
  assert.throws(
    () => parse({ email: 'nope' }, { name: string(), email: email() }),
    (err) => err.status === 400 && err.details.length === 2 && /name is required/.test(err.message),
  );
});

test('partial mode skips missing fields', () => {
  assert.deepEqual(parse({}, { name: string() }, { partial: true }), {});
});

test('rejects non-object bodies', () => {
  assert.throws(() => parse(null, {}), /JSON object/);
  assert.throws(() => parse([], {}), /JSON object/);
});

test('email, phone and timezone validators', () => {
  assert.equal(email()('A@Example.COM'), 'a@example.com');
  assert.throws(() => email()('a@b'), /valid email/);
  assert.equal(phone()('+91 98765-43210'), '+919876543210');
  assert.throws(() => phone()('9876543210'), /international format/);
  assert.equal(timezone()('Asia/Kolkata'), 'Asia/Kolkata');
  assert.throws(() => timezone()('Mars/Base'), /time zone/);
});

test('optional, oneOf, boolean, array and object validators', () => {
  assert.equal(optional(string())(''), undefined);
  assert.throws(() => oneOf(['a'])('b'), /one of/);
  assert.throws(() => boolean()('true'), /true or false/);
  assert.throws(() => array(string(), { max: 1 })(['a', 'b']), /at most 1/);
  assert.throws(() => array(string())(['ok', 5]), /item 2/);
  assert.deepEqual(object({ a: string() })({ a: 'x', b: 'y' }), { a: 'x' });
});
