import { paths } from '../store/index.js';
import { buildMessage } from './messages.js';

/**
 * Sends a message to a list of members over every channel they have turned on,
 * and records it in a per-profile notification ledger. The ledger id doubles
 * as a lock: a reminder is sent at most once, even if two runs overlap.
 */
export function createNotifier({ store, channels, logger, now, translator }) {
  const ledger = (pid) => store.collection(paths.notifications(pid));
  const iso = () => new Date(now()).toISOString();

  /** Translates a message into the member's language (Cloud Translation). Falls back to English. */
  const localize = async (message, language) => {
    if (!translator || !language || language === 'en' || !message.parts) return message;
    const p = message.parts;
    const strings = [
      p.subject,
      p.heading,
      ...p.paragraphs,
      ...p.actions.map((a) => a.label),
      p.footer,
    ];
    try {
      const t = await translator.translate(strings, language);
      const n = p.paragraphs.length;
      return buildMessage({
        subject: t[0],
        heading: t[1],
        paragraphs: t.slice(2, 2 + n),
        actions: p.actions.map((a, i) => ({ ...a, label: t[2 + n + i] })),
        footer: t.at(-1),
      });
    } catch (err) {
      logger.warn('translation_fallback', { language, error: err.message });
      return message;
    }
  };

  /** Which channels can reach this member right now. */
  const routesFor = (member) => {
    const routes = [];
    if (channels.email && member.notify?.email && member.email)
      routes.push({ channel: channels.email, to: member.email });
    return routes;
  };

  return {
    routesFor,

    /**
     * @param {string} pid
     * @param {{ id: string, kind: string, recipients: object[], build: (recipient: object) => object, ref?: object }} n
     * @returns {Promise<{ sent: number, failed: number, skipped?: boolean }>}
     */
    async send(pid, { id, kind, recipients, build, ref = {} }) {
      const targets = recipients.filter((m) => m.status === 'active' && routesFor(m).length);
      if (!targets.length) return { sent: 0, failed: 0, noRecipients: true };

      try {
        await ledger(pid).create(id, { kind, ref, status: 'sending', createdAt: iso() });
      } catch (err) {
        if (err.code === 'ALREADY_EXISTS') return { sent: 0, failed: 0, skipped: true };
        throw err;
      }

      const deliveries = [];
      for (const member of targets) {
        const message = await localize(build(member), member.language);
        for (const { channel, to } of routesFor(member)) {
          try {
            const result = await channel.send({ to, ...message, member });
            deliveries.push({
              memberId: member.id,
              name: member.name,
              channel: channel.name,
              status: 'sent',
              providerId: result?.id ?? null,
            });
          } catch (err) {
            logger.warn('notification_failed', {
              kind,
              channel: channel.name,
              memberId: member.id,
              error: err.message,
            });
            deliveries.push({
              memberId: member.id,
              name: member.name,
              channel: channel.name,
              status: 'failed',
              error: err.message.slice(0, 200),
            });
          }
        }
      }

      const sent = deliveries.filter((d) => d.status === 'sent').length;
      const failed = deliveries.length - sent;
      if (sent === 0) {
        // Nothing got through: release the lock so the next run tries again.
        await ledger(pid).delete(id);
      } else {
        await ledger(pid).update(id, {
          status: failed ? 'partial' : 'sent',
          deliveries,
          sentAt: iso(),
          subject: build(targets[0]).subject,
        });
      }
      return { sent, failed };
    },

    /** True if this notification was already sent (lets callers skip costly preparation). */
    async alreadySent(pid, id) {
      return Boolean(await ledger(pid).get(id));
    },

    /** Recent notifications, newest first (for the "who was told what" view). */
    async history(pid, { limit = 50 } = {}) {
      const items = await ledger(pid).list({
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit,
      });
      return items.filter((n) => n.status !== 'sending');
    },
  };
}
