import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPasscode, verifyPasscode, passcodeWeakness } from '../src/lib/passcode.js';
import { createTokenService } from '../src/lib/tokens.js';
import { can } from '../src/lib/permissions.js';
import { normalizeProfileCode, randomCode } from '../src/lib/ids.js';

test('passcodes are salted hashes that verify correctly', async () => {
  const a = await hashPasscode('mango-tree-42');
  const b = await hashPasscode('mango-tree-42');
  assert.notEqual(a, b, 'salt makes each hash unique');
  assert.ok(!a.includes('mango'));
  assert.equal(await verifyPasscode('mango-tree-42', a), true);
  assert.equal(await verifyPasscode('wrong', a), false);
  assert.equal(await verifyPasscode('x', 'garbage'), false);
});

test('weak passcodes are refused', () => {
  assert.match(passcodeWeakness('12345'), /at least 6/);
  assert.match(passcodeWeakness('111111'), /repeated/);
  assert.match(passcodeWeakness('123456'), /sequence/);
  assert.match(passcodeWeakness('654321'), /sequence/);
  assert.equal(passcodeWeakness('482917'), null);
});

test('session tokens: valid, tampered and expired', () => {
  let t = 1_000_000_000_000;
  const tokens = createTokenService({ secret: 's'.repeat(32), ttlSeconds: 60, now: () => t });
  const token = tokens.issue({ pid: 'P', mid: 'M', v: 1 });
  assert.equal(tokens.verify(token).mid, 'M');

  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ pid: 'P', mid: 'ADMIN', v: 1, exp: 9e12 })).toString('base64url');
  assert.equal(tokens.verify(`${forged}.${sig}`), null);
  assert.equal(tokens.verify(`${body}.${sig}x`), null);
  assert.equal(tokens.verify('not-a-token'), null);

  t += 61_000;
  assert.equal(tokens.verify(token), null, 'expired');
});

test('token service refuses short secrets', () => {
  assert.throws(() => createTokenService({ secret: 'short', ttlSeconds: 60 }), /32 characters/);
});

test('role permissions keep the elder in charge', () => {
  assert.equal(can('elder', 'changes:review'), true);
  assert.equal(can('family', 'changes:review'), false);
  assert.equal(can('caretaker', 'members:manage'), false);
  assert.equal(can('family', 'changes:propose'), true);
  assert.equal(can('stranger', 'profile:read'), false);
});

test('profile codes avoid confusing characters and normalise input', () => {
  assert.match(randomCode(50), /^[2-9A-HJKMNP-Z]+$/);
  assert.equal(normalizeProfileCode(' ab2c-d3ef '), 'AB2CD3EF');
});
