import { HttpError } from '../lib/httpError.js';
import { can } from '../lib/permissions.js';

/**
 * Verifies the Bearer token and loads the member on every request, so removed
 * members and changed passcodes take effect immediately.
 */
export function authenticate({ tokens, profiles }) {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    const claims = scheme === 'Bearer' ? tokens.verify(token) : null;
    if (!claims || claims.typ !== 'session') throw new HttpError(401, 'Please sign in.', 'UNAUTHENTICATED');

    const member = await profiles.getMember(claims.pid, claims.mid);
    if (!member || member.status !== 'active' || member.tokenVersion !== claims.v) {
      throw new HttpError(401, 'Your session has ended. Please sign in again.', 'UNAUTHENTICATED');
    }
    req.auth = { profileId: claims.pid, member };
    next();
  };
}

/** Allows the request only if the member's role has the permission. */
export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!can(req.auth?.member?.role, permission)) {
      throw new HttpError(403, 'You do not have permission to do that.', 'FORBIDDEN');
    }
    next();
  };
}

export const issueSession = (tokens, profileId, member) =>
  tokens.issue({ typ: 'session', pid: profileId, mid: member.id, v: member.tokenVersion });
