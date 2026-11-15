import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal signed session tokens (HMAC-SHA256), sent as `Authorization: Bearer`.
 * Bearer tokens (not cookies) mean no CSRF exposure. Tokens are revoked by
 * bumping the member's tokenVersion, which the auth middleware checks.
 */
export function createTokenService({ secret, ttlSeconds, now = () => Date.now() }) {
  if (!secret || secret.length < 32) throw new Error('Session secret must be at least 32 characters');

  const sign = (body) => createHmac('sha256', secret).update(body).digest('base64url');

  return {
    /** @param {object} claims @param {{ ttlSeconds?: number }} [opts] */
    issue(claims, opts = {}) {
      const payload = { ...claims, exp: Math.floor(now() / 1000) + (opts.ttlSeconds ?? ttlSeconds) };
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${body}.${sign(body)}`;
    },

    /** Returns the claims, or null if the token is malformed, forged or expired. */
    verify(token) {
      if (typeof token !== 'string' || token.length > 2048) return null;
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra !== undefined) return null;
      const expected = Buffer.from(sign(body));
      const actual = Buffer.from(signature);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      let claims;
      try {
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now()) return null;
      return claims;
    },
  };
}
