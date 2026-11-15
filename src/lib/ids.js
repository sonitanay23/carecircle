import { randomBytes, randomInt, randomUUID, createHash } from 'node:crypto';

// No 0/O, 1/I/L: easy to read aloud and type for older users.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Cryptographically random code from an unambiguous alphabet. */
export function randomCode(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Profile codes are 8 characters, shown as XXXX-XXXX. */
export const newProfileCode = () => randomCode(8);
export const formatProfileCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;
export const normalizeProfileCode = (input) =>
  String(input ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');

export const newId = () => randomUUID();

/** URL-safe random secret (e.g. share links). */
export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

/** One-way hash for high-entropy secrets such as invite codes and share tokens. */
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
