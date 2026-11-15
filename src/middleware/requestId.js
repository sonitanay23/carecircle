import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[\w-]{1,64}$/;

/** Attaches a request id (reuses a safe incoming X-Request-Id) for log correlation. */
export function requestId() {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  };
}
