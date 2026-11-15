/**
 * Central, validated configuration. Reads from environment variables only,
 * so the same image runs locally and on Cloud Run (secrets via Secret Manager).
 */

import { randomBytes } from 'node:crypto';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const STORES = ['memory', 'firestore'];

/**
 * Builds a frozen config object from an env map.
 * @param {Record<string, string | undefined>} env
 */
export function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT ?? '8080', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  const logLevel = (env.LOG_LEVEL ?? 'info').toLowerCase();
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${env.LOG_LEVEL}`);
  }

  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const store = (env.STORE ?? (isProduction ? 'firestore' : 'memory')).toLowerCase();
  if (!STORES.includes(store)) throw new Error(`Invalid STORE: ${env.STORE}`);

  // Production must supply a real secret (from Secret Manager). Locally we make
  // a random one, so sessions simply reset when the server restarts.
  const sessionSecret = env.SESSION_SECRET ?? (isProduction ? undefined : randomBytes(32).toString('hex'));
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters');
  }

  const ttlHours = Number.parseInt(env.SESSION_TTL_HOURS ?? '12', 10);
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 24 * 30) {
    throw new Error(`Invalid SESSION_TTL_HOURS: ${env.SESSION_TTL_HOURS}`);
  }

  const missedAfterMinutes = Number.parseInt(env.MISSED_AFTER_MINUTES ?? '60', 10);
  if (!Number.isInteger(missedAfterMinutes) || missedAfterMinutes < 5 || missedAfterMinutes > 720) {
    throw new Error(`Invalid MISSED_AFTER_MINUTES: ${env.MISSED_AFTER_MINUTES}`);
  }

  const int = (name, fallback, min, max) => {
    const v = Number.parseInt(env[name] ?? String(fallback), 10);
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`Invalid ${name}: ${env[name]}`);
    return v;
  };

  const mailTransport = (env.MAIL_TRANSPORT ?? (env.SMTP_HOST ? 'smtp' : 'log')).toLowerCase();
  if (!['smtp', 'log'].includes(mailTransport)) throw new Error(`Invalid MAIL_TRANSPORT: ${env.MAIL_TRANSPORT}`);
  if (mailTransport === 'smtp' && (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS)) {
    throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS are required when MAIL_TRANSPORT=smtp');
  }
  if (env.CRON_SECRET !== undefined && env.CRON_SECRET.length < 24) {
    throw new Error('CRON_SECRET must be at least 24 characters');
  }

  return Object.freeze({
    port,
    logLevel,
    nodeEnv,
    isProduction,
    appBaseUrl: (env.APP_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    store,
    gcpProject: env.GOOGLE_CLOUD_PROJECT,
    firestoreDatabase: env.FIRESTORE_DATABASE,
    sessionSecret,
    sessionTtlSeconds: ttlHours * 3600,
    // A dose with no record this long after its time counts as missed.
    missedAfterMinutes,
    reminders: Object.freeze({
      // Upcoming-dose reminder this many minutes before the dose.
      leadMinutes: int('REMINDER_LEAD_MINUTES', 10, 0, 120),
      // Tell family if a missed dose is still not taken this long after the missed alert.
      escalateAfterMinutes: int('ESCALATE_AFTER_MINUTES', 60, 5, 720),
      // Never alert about doses older than this (e.g. on first deploy).
      lookbackHours: int('REMINDER_LOOKBACK_HOURS', 12, 1, 48),
    }),
    // Shared secret Cloud Scheduler sends to trigger the reminder run.
    cronSecret: env.CRON_SECRET ?? null,
    gemini: Object.freeze({
      apiKey: env.GEMINI_API_KEY || null,
      // Alias that always points at the newest Flash model; pin a version if needed.
      model: env.GEMINI_MODEL || 'gemini-flash-latest',
    }),
    // Cloud Translation and Text-to-Speech. On Cloud Run they use the service
    // account (no key). Locally, set GOOGLE_API_KEY to try them.
    googleCloud: Object.freeze({
      apiKey: env.GOOGLE_API_KEY || null,
      useMetadata: Boolean(env.K_SERVICE) && env.GOOGLE_CLOUD_AUTH !== 'off',
    }),
    mail: Object.freeze({
      transport: mailTransport,
      host: env.SMTP_HOST ?? null,
      port: int('SMTP_PORT', 465, 1, 65535),
      user: env.SMTP_USER ?? null,
      pass: env.SMTP_PASS ?? null,
      from: env.MAIL_FROM ?? (env.SMTP_USER ? `CareCircle <${env.SMTP_USER}>` : 'CareCircle <no-reply@carecircle.local>'),
    }),
    version: env.K_REVISION ?? 'local',
  });
}
