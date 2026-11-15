import { Router } from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import { HttpError } from '../lib/httpError.js';

const digest = (s) => createHash('sha256').update(String(s)).digest();

/**
 * Endpoints called by Google Cloud Scheduler, not by people. Protected by a
 * shared secret in the X-Cron-Secret header (stored in Secret Manager). If no
 * secret is configured the endpoint is switched off.
 */
export function internalRouter({ services, config }) {
  const router = Router();

  const requireCronSecret = (req, _res, next) => {
    if (!config.cronSecret)
      throw new HttpError(503, 'Scheduled jobs are not configured', 'NOT_CONFIGURED');
    // Compare fixed-length digests so the check takes the same time for any input.
    if (!timingSafeEqual(digest(req.get('x-cron-secret') ?? ''), digest(config.cronSecret))) {
      throw new HttpError(401, 'Unauthorized', 'UNAUTHENTICATED');
    }
    next();
  };

  router.post('/reminders/run', requireCronSecret, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await services.reminders.runAll());
  });

  return router;
}
