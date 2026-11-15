/**
 * Starts the real app with an in-memory store, a memory mailbox and fake AI,
 * for browser tests. Usage: node test/e2e/server.mjs [port]
 */
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/lib/logger.js';
import { createMemoryStore } from '../../src/store/memoryStore.js';
import { buildServices } from '../../src/services/index.js';
import { createMemoryEmailChannel } from '../../src/notify/email.js';

/** What the fake Gemini last received (so tests can check uploads). */
export const seen = { lastImage: null };

export function fakeAi() {
  return {
    gemini: {
      async generateJson({ instruction, parts = [] }) {
        if (instruction.includes('prescription')) {
          const img = parts[0]?.inlineData;
          seen.lastImage = img
            ? { mimeType: img.mimeType, bytes: Buffer.from(img.data, 'base64').length }
            : null;
          return {
            readable: true,
            medications: [
              {
                name: 'Atorvastatin',
                dose: '10 mg',
                form: 'tablet',
                instructions: 'After food',
                times: ['22:00'],
                asNeeded: false,
                durationDays: 30,
                confidence: 'low',
              },
            ],
            warnings: [],
          };
        }
        if (instruction.includes('Explain'))
          return {
            summary: 'Usually used to control blood sugar.',
            howToTake: 'With food.',
            commonSideEffects: ['Upset stomach'],
            askDoctorIf: ['You feel very weak'],
          };
        if (instruction.includes('interactions'))
          return { concerns: [], summary: 'No well-known clashes.' };
        if (instruction.includes('summary'))
          return {
            overview: 'Medicines were taken well.',
            medicines: 'Most doses taken.',
            readings: 'One reading.',
            questionsForDoctor: ['Is my blood pressure OK?'],
          };
        return { answer: 'Your next medicine is at 8 in the evening.', needsDoctor: false };
      },
    },
    speech: { synthesize: async () => Buffer.from('ID3') },
    translator: null,
  };
}

export async function startE2eServer(port = 0) {
  const config = loadConfig({
    APP_BASE_URL: `http://127.0.0.1:${port || 8090}`,
    CRON_SECRET: 'e2e-cron-secret-0123456789abcd',
  });
  const email = createMemoryEmailChannel();
  const services = buildServices({
    store: createMemoryStore(),
    config,
    logger: createLogger({ level: 'error' }),
    channels: { email },
    ai: fakeAi(),
  });
  const app = createApp({ config, logger: createLogger({ level: 'error' }), services });
  const server = await new Promise((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return { server, services, email, url: `http://127.0.0.1:${server.address().port}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startE2eServer(Number(process.argv[2] ?? 8090));
  process.stdout.write(`e2e server on ${url}\n`);
}
