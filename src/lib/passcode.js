import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 32;
const PARAMS = { N: 16384, r: 8, p: 1 };

export const PASSCODE_MIN = 6;
export const PASSCODE_MAX = 64;

/**
 * Returns a reason the passcode is too weak, or null if it is acceptable.
 * Blocks repeated characters (111111) and simple sequences (123456, 654321).
 */
export function passcodeWeakness(passcode) {
  if (typeof passcode !== 'string') return 'Passcode must be text';
  if (passcode.length < PASSCODE_MIN) return `Passcode must be at least ${PASSCODE_MIN} characters`;
  if (passcode.length > PASSCODE_MAX) return `Passcode must be at most ${PASSCODE_MAX} characters`;
  if (/^(.)\1+$/.test(passcode)) return 'Passcode cannot be the same character repeated';
  const codes = [...passcode].map((c) => c.charCodeAt(0));
  const steps = codes.slice(1).map((c, i) => c - codes[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) {
    return 'Passcode cannot be a simple sequence like 123456';
  }
  return null;
}

/** Hashes a passcode with scrypt and a random salt. Format: scrypt$<salt>$<hash>. */
export async function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(passcode, salt, KEY_LENGTH, PARAMS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Constant-time comparison of a passcode against a stored hash. */
export async function verifyPasscode(passcode, stored) {
  if (typeof passcode !== 'string' || typeof stored !== 'string') return false;
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(
    passcode,
    Buffer.from(saltB64, 'base64'),
    expected.length,
    PARAMS,
  );
  return timingSafeEqual(actual, expected);
}

// Used when the profile does not exist, so failed lookups take as long as real ones.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
export const burnPasscodeCheck = (passcode) => verifyPasscode(String(passcode ?? ''), DUMMY_HASH);
