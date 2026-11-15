import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/lib/logger.js';
import { createMemoryStore } from '../src/store/memoryStore.js';
import { buildServices } from '../src/services/index.js';
import { createMemoryEmailChannel } from '../src/notify/email.js';

/** A controllable clock for time-dependent tests (lockouts, expiry). */
export function createClock(start = Date.parse('2026-11-15T09:00:00Z')) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

export const silentLogger = () => createLogger({ level: 'error', sink: () => {} });

export function buildTestServices({ clock = createClock(), env = {}, channels, ai } = {}) {
  const config = loadConfig({
    APP_BASE_URL: 'https://care.example',
    CRON_SECRET: 'test-cron-secret-0123456789',
    ...env,
  });
  const email = createMemoryEmailChannel();
  const services = buildServices({
    store: createMemoryStore(),
    config,
    logger: silentLogger(),
    now: clock.now,
    channels: channels ?? { email },
    ai,
  });
  return { services, config, clock, email };
}

export const elderInput = (overrides = {}) => ({
  elderName: 'Kamala Devi',
  email: 'kamala@example.com',
  timezone: 'Asia/Kolkata',
  language: 'hi',
  passcode: 'mango-tree-42',
  ...overrides,
});

/** Creates a profile with an elder and one joined family member. */
export async function seedFamily(services) {
  const { profile, member: elder } = await services.profiles.createProfile(elderInput());
  const { inviteCode } = await services.profiles.invite(profile.id, elder, {
    name: 'Riya',
    role: 'family',
  });
  const { member: family } = await services.profiles.join({
    profileCode: profile.id,
    inviteCode,
    passcode: 'riya-secret-7',
    email: 'riya@example.com',
    timezone: 'America/Los_Angeles',
    language: 'en',
  });
  return { profile, elder, family, pid: profile.id };
}

/** Adds a medicine as the elder (applies straight away) and returns it. */
export async function addMedication(services, pid, elder, overrides = {}) {
  const { change } = await services.medications.proposeCreate(pid, elder, {
    name: 'Metformin',
    dose: '500 mg',
    form: 'tablet',
    instructions: 'After food',
    schedule: { times: ['20:00', '08:00'], startDate: '2026-11-01' },
    stock: { count: 20, perDose: 1, lowAtDays: 5 },
    ...overrides,
  });
  return services.medications.get(pid, change.targetId);
}

/**
 * Fake Gemini client. `answers` maps a word that appears in the instruction to
 * the JSON to return. Every call is recorded in `calls`.
 */
export function fakeGemini(answers) {
  const calls = [];
  return {
    calls,
    async generateJson(req) {
      calls.push(req);
      const key = Object.keys(answers).find((k) => req.instruction.includes(k));
      if (!key) throw new Error(`fakeGemini: no answer for "${req.instruction.slice(0, 60)}"`);
      const a = answers[key];
      return typeof a === 'function' ? a(req) : structuredClone(a);
    },
  };
}
