import { paths } from '../store/index.js';
import { HttpError } from '../lib/httpError.js';
import { newId } from '../lib/ids.js';

/**
 * "Elder approves changes". Family and caretakers propose edits; the elder
 * approves or rejects them. The elder's own edits (or everyone's, if the elder
 * turns approval off) apply straight away. Each entity type (medical ID,
 * medication, appointment...) registers an "applier" that performs the edit.
 */
export function createChangeService({ store, activity, profiles, now }) {
  const changes = (pid) => store.collection(paths.changes(pid));
  const appliers = new Map();
  const iso = () => new Date(now()).toISOString();

  const apply = async (pid, actor, change) => {
    const applier = appliers.get(change.entity);
    if (!applier) throw new Error(`No applier registered for ${change.entity}`);
    return applier(pid, actor, change);
  };

  const api = {
    /**
     * @param {string} entity e.g. 'medicalId', 'medication', 'appointment'
     * @param {(pid: string, actor: object, change: object) => Promise<{ entityId?: string, record?: object }>} fn
     */
    registerApplier(entity, fn) {
      appliers.set(entity, fn);
    },

    /**
     * @returns {Promise<{ status: 'applied' | 'pending', change: object, result?: object }>}
     */
    async propose(pid, actor, { entity, action, targetId = null, data = {}, summary }) {
      if (!appliers.has(entity)) throw new Error(`No applier registered for ${entity}`);
      const profile = await profiles.getProfile(pid);
      const needsApproval = actor.role !== 'elder' && profile.settings?.requireApproval !== false;
      const base = {
        entity,
        action,
        targetId,
        data,
        summary,
        proposedBy: { id: actor.id, name: actor.name, role: actor.role },
        createdAt: iso(),
      };

      if (!needsApproval) {
        const result = await apply(pid, actor, base);
        const change = await changes(pid).create(newId(), {
          ...base,
          targetId: result?.entityId ?? targetId,
          status: 'applied',
          reviewedBy: null,
          reviewedAt: base.createdAt,
        });
        await activity.record(pid, actor, {
          action: `${entity}.${action}`,
          summary: `${actor.name}: ${summary}`,
          entity,
          entityId: change.targetId,
        });
        return { status: 'applied', change, result };
      }

      const change = await changes(pid).create(newId(), { ...base, status: 'pending' });
      await activity.record(pid, actor, {
        action: 'change.proposed',
        summary: `${actor.name} suggested: ${summary} (waiting for ${profile.elderName}'s OK)`,
        entity: 'change',
        entityId: change.id,
      });
      return { status: 'pending', change };
    },

    async list(pid, { status } = {}) {
      if (!status)
        return changes(pid).list({
          orderBy: { field: 'createdAt', direction: 'desc' },
          limit: 100,
        });
      // Filter in Firestore, sort here: avoids needing a composite index (status + createdAt).
      const items = await changes(pid).list({ where: [['status', '==', status]] });
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    },

    async get(pid, changeId) {
      const change = await changes(pid).get(changeId);
      if (!change) throw new HttpError(404, 'Change not found', 'NOT_FOUND');
      return change;
    },

    async approve(pid, elder, changeId) {
      const change = await api.get(pid, changeId);
      if (change.status !== 'pending')
        throw new HttpError(409, 'This change was already handled.', 'NOT_PENDING');
      let result;
      try {
        result = await apply(pid, change.proposedBy, change);
      } catch (err) {
        if (err instanceof HttpError && err.status < 500) {
          await changes(pid).update(changeId, {
            status: 'failed',
            reviewedBy: elder.id,
            reviewedAt: iso(),
            failure: err.message,
          });
          throw new HttpError(
            409,
            `This change can no longer be applied: ${err.message}`,
            'APPLY_FAILED',
          );
        }
        throw err;
      }
      const updated = await changes(pid).update(changeId, {
        status: 'approved',
        targetId: result?.entityId ?? change.targetId,
        reviewedBy: elder.id,
        reviewedAt: iso(),
      });
      await activity.record(pid, elder, {
        action: 'change.approved',
        summary: `${elder.name} approved ${change.proposedBy.name}'s change: ${change.summary}`,
        entity: change.entity,
        entityId: updated.targetId,
      });
      return { change: updated, result };
    },

    async reject(pid, elder, changeId, reason) {
      const change = await api.get(pid, changeId);
      if (change.status !== 'pending')
        throw new HttpError(409, 'This change was already handled.', 'NOT_PENDING');
      const updated = await changes(pid).update(changeId, {
        status: 'rejected',
        reviewedBy: elder.id,
        reviewedAt: iso(),
        reason: reason ?? null,
      });
      await activity.record(pid, elder, {
        action: 'change.rejected',
        summary: `${elder.name} said no to ${change.proposedBy.name}'s change: ${change.summary}${reason ? ` (${reason})` : ''}`,
        entity: 'change',
        entityId: changeId,
      });
      return updated;
    },

    /** The person who suggested a change can withdraw it while it is pending. */
    async withdraw(pid, member, changeId) {
      const change = await api.get(pid, changeId);
      if (change.proposedBy.id !== member.id)
        throw new HttpError(403, 'You can only withdraw your own suggestions.', 'FORBIDDEN');
      if (change.status !== 'pending')
        throw new HttpError(409, 'This change was already handled.', 'NOT_PENDING');
      const updated = await changes(pid).update(changeId, {
        status: 'withdrawn',
        reviewedAt: iso(),
      });
      await activity.record(pid, member, {
        action: 'change.withdrawn',
        summary: `${member.name} withdrew their suggestion: ${change.summary}`,
        entity: 'change',
        entityId: changeId,
      });
      return updated;
    },
  };
  return api;
}
