import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';
import { createStore } from './store/index.js';
import { buildServices } from './services/index.js';
import { createEmailChannel } from './notify/email.js';
import { createGeminiClient } from './ai/gemini.js';
import { createGoogleAuth } from './ai/googleAuth.js';
import { createTranslator } from './ai/translate.js';
import { createSpeech } from './ai/speech.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const store = await createStore(config);
const channels = { email: await createEmailChannel({ config, logger }) };
const googleAuth = createGoogleAuth(config.googleCloud);
const ai = {
  gemini: createGeminiClient({ ...config.gemini, logger }),
  translator: createTranslator({ auth: googleAuth, logger }),
  speech: createSpeech({ auth: googleAuth, logger }),
};
const services = buildServices({ store, config, logger, channels, ai });
const app = createApp({ config, logger, services });

const server = app.listen(config.port, (err) => {
  // Express 5 passes listen errors here (e.g. the port is already in use).
  if (err) {
    logger.error('server_failed_to_start', {
      port: config.port,
      err,
      hint:
        err.code === 'EADDRINUSE'
          ? `Port ${config.port} is already in use. Stop the other server (lsof -ti :${config.port} | xargs kill) or set PORT.`
          : undefined,
    });
    process.exit(1);
  }
  logger.info('server_started', {
    port: config.port,
    env: config.nodeEnv,
    store: store.kind,
    mail: config.mail.transport,
    gemini: Boolean(ai.gemini),
    translation: Boolean(ai.translator),
    speech: Boolean(ai.speech),
  });
});

// Cloud Run sends SIGTERM before stopping an instance; finish in-flight requests.
const shutdown = (signal) => {
  logger.info('shutdown', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', {
    err: reason instanceof Error ? reason : new Error(String(reason)),
  });
});
