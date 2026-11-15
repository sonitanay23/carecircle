import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';
import { internalRouter } from './routes/internal.js';
import { actionsRouter } from './routes/actions.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * Builds the Express app. Dependencies are injected so tests can run without
 * any cloud services.
 * @param {{
 *   config: ReturnType<import('./config.js').loadConfig>,
 *   logger: ReturnType<import('./lib/logger.js').createLogger>,
 *   services: ReturnType<import('./services/index.js').buildServices>,
 * }} deps
 */
export function createApp({ config, logger, services }) {
  const app = express();

  // Cloud Run sits behind one Google front-end proxy; trust it for client IPs.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'connect-src': ["'self'"],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));

  app.use('/healthz', healthRouter(config));

  // Rate-limit the API to slow down passcode guessing and abuse.
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use('/api', apiRouter({ services, config }));
  app.use('/api', notFound());

  // Called by Cloud Scheduler every few minutes to send reminders.
  app.use('/internal', internalRouter({ services, config }));
  // One-tap "I've taken it" links from reminder emails.
  app.use('/a', actionsRouter({ services, config }));

  // Invite links (/join?profile=ABCD-EFGH) open the app's join screen.
  app.get('/join', (req, res) => {
    const code = String(req.query.profile ?? '').replace(/[^0-9A-Za-z-]/g, '').slice(0, 12);
    res.redirect(302, `/#/join${code ? `?profile=${code}` : ''}`);
  });
  // Public emergency card opened from the medical ID QR code.
  app.get('/id/:token', (_req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.sendFile(path.join(PUBLIC_DIR, 'id.html'));
  });

  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ['html'],
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders: (res, filePath) => {
        // The service worker must always be re-checked so updates reach people.
        if (filePath.endsWith('sw.js')) res.set('Cache-Control', 'no-cache');
        if (filePath.endsWith('.webmanifest')) res.set('Content-Type', 'application/manifest+json');
      },
    }),
  );

  app.use(notFound());
  app.use(errorHandler(logger));
  return app;
}
