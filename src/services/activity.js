import { paths } from '../store/index.js';
import { randomCode } from '../lib/ids.js';

/**
 * Append-only activity log: who did what, and when. Every change to a profile
 * is recorded here so the elder and family can see a clear history.
 */
export function createActivityService({ store, now }) {
  // Tie-breaker so entries written in the same millisecond keep their order.
  let counter = 0;

  return {
    /**
     * @param {string} profileId
     * @param {{ id: string, name: string, role: string } | null} actor null = system
     * @param {{ action: string, summary: string, entity?: string, entityId?: string }} event
     */
    async record(profileId, actor, { action, summary, entity, entityId }) {
      const at = new Date(now()).toISOString();
      counter = (counter + 1) % 1_000_000;
      // Sortable key: time, then counter, then randomness to avoid collisions between instances.
      const seq = `${at}#${String(counter).padStart(6, '0')}#${randomCode(4)}`;
      return store.collection(paths.activity(profileId)).create(seq.replace(/[#:.]/g, '_'), {
        at,
        seq,
        action,
        summary,
        entity: entity ?? null,
        entityId: entityId ?? null,
        actor: actor ? { id: actor.id, name: actor.name, role: actor.role } : { id: 'system', name: 'CareCircle', role: 'system' },
      });
    },

    /** Newest first. `before` is the `seq` of the last entry already shown. */
    async list(profileId, { limit = 50, before } = {}) {
      return store.collection(paths.activity(profileId)).list({
        where: before ? [['seq', '<', before]] : [],
        orderBy: { field: 'seq', direction: 'desc' },
        limit: Math.min(Math.max(limit, 1), 200),
      });
    },
  };
}
