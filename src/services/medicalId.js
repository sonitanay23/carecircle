import { paths } from '../store/index.js';
import { HttpError } from '../lib/httpError.js';
import { randomToken, sha256 } from '../lib/ids.js';

export const BLOOD_GROUPS = Object.freeze(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown']);
const CARD_ID = 'card';
const VIEW_LOG_INTERVAL_MS = 60 * 60 * 1000;

const EMPTY_CARD = Object.freeze({
  bloodGroup: 'unknown',
  allergies: [],
  conditions: [],
  emergencyContacts: [],
  notes: '',
  updatedAt: null,
  share: null,
});

/**
 * Medical ID card: the information a doctor or paramedic needs in an emergency.
 * The elder can share it through a secret link (shown as a QR code) that works
 * without a passcode, and can turn that link off or replace it at any time.
 */
export function createMedicalIdService({ store, activity, changes, now, config, logger, extraPublicInfo }) {
  const medical = (pid) => store.collection(paths.medical(pid));
  const shares = () => store.collection(paths.medicalIdShares());
  const iso = () => new Date(now()).toISOString();
  const shareUrl = (token) => `${config.appBaseUrl}/id/${token}`;

  const getCard = async (pid) => {
    const card = await medical(pid).get(CARD_ID);
    return card ?? { ...EMPTY_CARD, id: CARD_ID };
  };

  // Edits go through the approval flow like any other health record.
  changes.registerApplier('medicalId', async (pid, _actor, change) => {
    const current = await getCard(pid);
    await medical(pid).set(CARD_ID, { ...current, ...change.data, updatedAt: iso() });
    return { entityId: CARD_ID };
  });

  /** What members see: the card plus the share link if sharing is on. */
  const forMembers = (card) => ({
    bloodGroup: card.bloodGroup,
    allergies: card.allergies,
    conditions: card.conditions,
    emergencyContacts: card.emergencyContacts,
    notes: card.notes,
    updatedAt: card.updatedAt,
    sharing: card.share ? { enabled: true, url: shareUrl(card.share.token), enabledAt: card.share.enabledAt } : { enabled: false },
  });

  return {
    async get(pid) {
      return forMembers(await getCard(pid));
    },

    async propose(pid, actor, data) {
      return changes.propose(pid, actor, {
        entity: 'medicalId',
        action: 'update',
        targetId: CARD_ID,
        data,
        summary: 'updated the medical ID card',
      });
    },

    /** Turns sharing on, or replaces the link (old QR codes stop working). */
    async enableSharing(pid, elder) {
      const card = await getCard(pid);
      if (card.share) await shares().delete(sha256(card.share.token));
      const token = randomToken(24);
      await shares().create(sha256(token), { profileId: pid, createdAt: iso() });
      await medical(pid).set(CARD_ID, { ...card, share: { token, enabledAt: iso() } });
      await activity.record(pid, elder, {
        action: 'medicalId.shared',
        summary: card.share
          ? `${elder.name} replaced the medical ID link. Old QR codes no longer work.`
          : `${elder.name} turned on the medical ID link.`,
      });
      return forMembers(await getCard(pid));
    },

    async disableSharing(pid, elder) {
      const card = await getCard(pid);
      if (!card.share) return forMembers(card);
      await shares().delete(sha256(card.share.token));
      await medical(pid).set(CARD_ID, { ...card, share: null });
      await activity.record(pid, elder, { action: 'medicalId.unshared', summary: `${elder.name} turned off the medical ID link.` });
      return forMembers(await getCard(pid));
    },

    /** Public, passcode-free view for emergencies. Returns only what a medic needs. */
    async publicView(token, profileService) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 64) {
        throw new HttpError(404, 'This medical ID link is not active.', 'NOT_FOUND');
      }
      const link = await shares().get(sha256(token));
      if (!link) throw new HttpError(404, 'This medical ID link is not active.', 'NOT_FOUND');
      const pid = link.profileId;
      const [card, profile] = await Promise.all([getCard(pid), profileService.getProfile(pid)]);

      if (!card.lastViewedAt || now() - Date.parse(card.lastViewedAt) > VIEW_LOG_INTERVAL_MS) {
        await medical(pid).update(CARD_ID, { lastViewedAt: iso() });
        await activity.record(pid, null, { action: 'medicalId.viewed', summary: 'Someone opened the medical ID link.' });
      }
      logger?.info('medical_id_viewed', { profileId: pid });

      return {
        name: profile.elderName,
        bloodGroup: card.bloodGroup,
        allergies: card.allergies,
        conditions: card.conditions,
        emergencyContacts: card.emergencyContacts,
        notes: card.notes,
        updatedAt: card.updatedAt,
        ...(extraPublicInfo ? await extraPublicInfo(pid) : {}),
      };
    },
  };
}
