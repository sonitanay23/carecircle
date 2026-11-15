import { Router } from 'express';

/** Liveness endpoint used by Cloud Run and uptime checks. */
export function healthRouter(config) {
  const router = Router();
  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', version: config.version, uptimeSeconds: Math.round(process.uptime()) });
  });
  return router;
}
