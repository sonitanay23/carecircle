/**
 * Small, dependency-free input validation. Each validator takes a raw value and
 * returns the cleaned value or throws a ValidationIssue. `parse` validates an
 * object against a schema and drops any keys the schema does not know about.
 */
import { HttpError } from './httpError.js';

class ValidationIssue extends Error {}

const fail = (msg) => {
  throw new ValidationIssue(msg);
};

export const LANGUAGES = Object.freeze(['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_E164 = /^\+[1-9]\d{7,14}$/;

/** Marks a validator as optional: undefined/null/'' pass through as undefined. */
export const optional = (validator) => {
  const v = (value) => (value === undefined || value === null || value === '' ? undefined : validator(value));
  v.optional = true;
  return v;
};

export const string =
  ({ min = 1, max = 200, pattern, trim = true } = {}) =>
  (value) => {
    if (typeof value !== 'string') fail('must be text');
    const s = trim ? value.trim() : value;
    if (s.length < min) fail(min === 1 ? 'is required' : `must be at least ${min} characters`);
    if (s.length > max) fail(`must be at most ${max} characters`);
    if (pattern && !pattern.test(s)) fail('has an invalid format');
    return s;
  };

export const email = () => (value) => {
  const s = string({ max: 254 })(value).toLowerCase();
  if (!EMAIL.test(s)) fail('must be a valid email address');
  return s;
};

export const phone = () => (value) => {
  const s = string({ max: 16 })(value).replace(/[\s-]/g, '');
  if (!PHONE_E164.test(s)) fail('must be in international format, e.g. +919876543210');
  return s;
};

export const timezone = () => (value) => {
  const s = string({ max: 64 })(value);
  try {
    new Intl.DateTimeFormat('en', { timeZone: s });
  } catch {
    fail('must be a valid time zone, e.g. Asia/Kolkata');
  }
  return s;
};

export const oneOf = (allowed) => (value) => {
  if (!allowed.includes(value)) fail(`must be one of: ${allowed.join(', ')}`);
  return value;
};

export const boolean = () => (value) => {
  if (typeof value !== 'boolean') fail('must be true or false');
  return value;
};

export const integer =
  ({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) =>
  (value) => {
    if (!Number.isInteger(value)) fail('must be a whole number');
    if (value < min || value > max) fail(`must be between ${min} and ${max}`);
    return value;
  };

export const array =
  (itemValidator, { max = 50 } = {}) =>
  (value) => {
    if (!Array.isArray(value)) fail('must be a list');
    if (value.length > max) fail(`must have at most ${max} items`);
    return value.map((item, i) => {
      try {
        return itemValidator(item);
      } catch (err) {
        if (err instanceof ValidationIssue) fail(`item ${i + 1} ${err.message}`);
        throw err;
      }
    });
  };

export const object = (schema) => (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
  const out = {};
  for (const [key, validator] of Object.entries(schema)) {
    try {
      const v = validator(value[key]);
      if (v !== undefined) out[key] = v;
    } catch (err) {
      if (err instanceof ValidationIssue) fail(`${key} ${err.message}`);
      throw err;
    }
  }
  return out;
};

/**
 * Validates `input` against `schema`; throws HttpError(400) listing every problem.
 * @param {unknown} input
 * @param {Record<string, (v: unknown) => unknown>} schema
 * @param {{ partial?: boolean }} [opts] partial: every field optional (for PATCH)
 */
export function parse(input, schema, { partial = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Request body must be a JSON object', 'VALIDATION');
  }
  const out = {};
  const problems = [];
  for (const [key, validator] of Object.entries(schema)) {
    const raw = input[key];
    if (partial && raw === undefined) continue;
    try {
      const v = validator(raw);
      if (v !== undefined) out[key] = v;
    } catch (err) {
      if (!(err instanceof ValidationIssue)) throw err;
      if (raw === undefined && !validator.optional) problems.push(`${key} is required`);
      else problems.push(`${key} ${err.message}`);
    }
  }
  if (problems.length) {
    const error = new HttpError(400, problems.join('; '), 'VALIDATION');
    error.details = problems;
    throw error;
  }
  return out;
}

export const timeOfDay = () => (value) => {
  const s = string({ max: 5 })(value);
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) fail('must be a time like 08:30');
  return s;
};

export const isoDate = () => (value) => {
  const s = string({ max: 10 })(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    fail('must be a date like 2026-11-15');
  }
  return s;
};

export const isoDateTime = () => (value) => {
  const s = string({ max: 40 })(value);
  if (Number.isNaN(Date.parse(s))) fail('must be a date and time');
  return new Date(s).toISOString();
};

export const number =
  ({ min = -Infinity, max = Infinity } = {}) =>
  (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a number');
    if (value < min || value > max) fail(`must be between ${min} and ${max}`);
    return value;
  };
