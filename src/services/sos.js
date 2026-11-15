import { HttpError } from '../lib/httpError.js';
import { googleMapsSearchUrl } from '../lib/links.js';
import { messages } from '../notify/messages.js';

const MINUTE = 60_000;

/**
 * SOS: one tap emails everyone else in the CareCircle, with the sender's
 * location if they shared it.
 * Pressing it again within the same minute does not send a second wave.
 */
export function createSosService({ profiles, notifier, activity, config, now }) {
  return {
    /**
     * @param {string} pid
     * @param {object} sender the signed-in member pressing SOS
     * @param {{ location?: { latitude: number, longitude: number, accuracyMeters?: number }, note?: string }} input
     */
    async trigger(pid, sender, { location, note } = {}) {
      const members = await profiles.listMembers(pid);
      const elder = members.find((m) => m.role === 'elder');
      const recipients = members.filter((m) => m.status === 'active' && m.id !== sender.id);
      const sentAt = now();
      const place = location
        ? {
            ...location,
            mapUrl: googleMapsSearchUrl(
              `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`,
            ),
          }
        : null;

      const result = await notifier.send(pid, {
        id: `sos_${sender.id}_${Math.floor(sentAt / MINUTE)}`,
        kind: 'sos',
        ref: {
          memberId: sender.id,
          location: place ? { latitude: place.latitude, longitude: place.longitude } : null,
        },
        recipients,
        build: (recipient) =>
          messages.sos({
            recipient,
            sender,
            elder,
            location: place,
            note,
            sentAt,
            appUrl: config.appBaseUrl,
          }),
      });

      if (result.skipped) return { status: 'already_sent', sent: 0, failed: 0 };
      if (result.noRecipients) {
        throw new HttpError(
          409,
          'No one in your CareCircle can be reached yet. If this is an emergency, call your local emergency number now.',
          'NO_RECIPIENTS',
        );
      }
      if (!result.sent) {
        throw new HttpError(
          502,
          'The SOS alert could not be sent. If this is an emergency, call your local emergency number now.',
          'SEND_FAILED',
        );
      }

      await activity.record(pid, sender, {
        action: 'sos.sent',
        summary: `${sender.name} sent an SOS alert${place ? ' with their location' : ''}.`,
        entity: 'member',
        entityId: sender.id,
      });
      return { status: 'sent', sent: result.sent, failed: result.failed };
    },
  };
}
