import { paths } from '../store/index.js';
import { HttpError } from '../lib/httpError.js';
import { newId, newProfileCode, normalizeProfileCode, randomCode, sha256 } from '../lib/ids.js';
import { hashPasscode, verifyPasscode, passcodeWeakness, burnPasscodeCheck } from '../lib/passcode.js';
import { INVITABLE_ROLES } from '../lib/permissions.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const INVITE_DAYS = 7;
export const MAX_MEMBERS = 10;

const BAD_LOGIN = 'The profile code or passcode is not right. Please check and try again.';

/** Member fields that are safe to send to clients. */
export function publicMember(m) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    status: m.status,
    email: m.email ?? null,
    phone: m.phone ?? null,
    timezone: m.timezone,
    language: m.language,
    notify: m.notify,
    createdAt: m.createdAt,
    joinedAt: m.joinedAt ?? null,
    inviteExpiresAt: m.status === 'invited' ? m.invite?.expiresAt ?? null : null,
  };
}

export function publicProfile(p) {
  return {
    code: p.id,
    elderName: p.elderName,
    timezone: p.timezone,
    language: p.language,
    settings: p.settings,
    createdAt: p.createdAt,
  };
}

/**
 * Profiles, members and passcode access.
 * Security: passcodes are scrypt-hashed, each member has their own passcode
 * (so every action is attributable), and repeated failures lock the profile.
 */
export function createProfileService({ store, activity, now }) {
  const profiles = () => store.collection(paths.profiles());
  const members = (pid) => store.collection(paths.members(pid));
  const iso = (ms = now()) => new Date(ms).toISOString();

  const assertStrong = (passcode) => {
    const weakness = passcodeWeakness(passcode);
    if (weakness) throw new HttpError(400, weakness, 'WEAK_PASSCODE');
  };

  /** Passcodes must be unique inside a profile, because sign-in is code + passcode. */
  const assertPasscodeUnused = async (pid, passcode, exceptMemberId) => {
    const active = await members(pid).list({ where: [['status', '==', 'active']] });
    const others = active.filter((m) => m.id !== exceptMemberId);
    const matches = await Promise.all(others.map((m) => verifyPasscode(passcode, m.passcodeHash)));
    if (matches.some(Boolean)) {
      throw new HttpError(409, 'Please choose a different passcode.', 'PASSCODE_TAKEN');
    }
  };

  const assertNotLocked = (profile) => {
    if (profile.security?.lockedUntil && Date.parse(profile.security.lockedUntil) > now()) {
      throw new HttpError(429, `Too many wrong attempts. Please try again in ${LOCKOUT_MINUTES} minutes.`, 'LOCKED');
    }
  };

  const recordFailure = async (profile) => {
    const failed = (profile.security?.failedAttempts ?? 0) + 1;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      await profiles().update(profile.id, {
        'security.failedAttempts': 0,
        'security.lockedUntil': iso(now() + LOCKOUT_MINUTES * 60_000),
      });
      await activity.record(profile.id, null, {
        action: 'security.locked',
        summary: `Sign-in was locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS} wrong passcodes.`,
      });
    } else {
      await profiles().update(profile.id, { 'security.failedAttempts': failed });
    }
  };

  const resetFailures = (profile) =>
    profile.security?.failedAttempts
      ? profiles().update(profile.id, { 'security.failedAttempts': 0, 'security.lockedUntil': null })
      : null;

  async function generateUniqueCode() {
    for (let i = 0; i < 5; i += 1) {
      const code = newProfileCode();
      if (!(await profiles().get(code))) return code;
    }
    throw new HttpError(503, 'Could not create a profile right now. Please try again.', 'CODE_EXHAUSTED');
  }

  const api = {
    /** Creates a profile and its elder member. The elder is the owner. */
    async createProfile({ elderName, email, phone, timezone, language, passcode }) {
      assertStrong(passcode);
      const code = await generateUniqueCode();
      const createdAt = iso();
      const elderId = newId();
      const profile = await profiles().create(code, {
        elderName,
        timezone,
        language,
        elderMemberId: elderId,
        settings: { requireApproval: true },
        security: { failedAttempts: 0, lockedUntil: null },
        createdAt,
      });
      const elder = await members(code).create(elderId, {
        name: elderName,
        role: 'elder',
        status: 'active',
        email,
        phone: phone ?? null,
        timezone,
        language,
        notify: { email: Boolean(email) },
        passcodeHash: await hashPasscode(passcode),
        tokenVersion: 1,
        createdAt,
        joinedAt: createdAt,
      });
      await activity.record(code, elder, { action: 'profile.created', summary: `${elderName} created their CareCircle.` });
      return { profile, member: elder };
    },

    async getProfile(pid) {
      const profile = await profiles().get(pid);
      if (!profile) throw new HttpError(404, 'Profile not found', 'NOT_FOUND');
      return profile;
    },

    async getMember(pid, memberId) {
      return members(pid).get(memberId);
    },

    async listMembers(pid, { includeRemoved = false } = {}) {
      const all = await members(pid).list({ orderBy: { field: 'createdAt', direction: 'asc' } });
      return includeRemoved ? all : all.filter((m) => m.status !== 'removed');
    },

    /** Sign in with profile code + personal passcode. */
    async login({ profileCode, passcode }) {
      const pid = normalizeProfileCode(profileCode);
      const profile = pid ? await profiles().get(pid) : null;
      if (!profile) {
        await burnPasscodeCheck(passcode);
        throw new HttpError(401, BAD_LOGIN, 'BAD_CREDENTIALS');
      }
      assertNotLocked(profile);
      const active = await members(pid).list({ where: [['status', '==', 'active']] });
      const results = await Promise.all(active.map((m) => verifyPasscode(passcode, m.passcodeHash)));
      const member = active[results.indexOf(true)];
      if (!member) {
        await recordFailure(profile);
        throw new HttpError(401, BAD_LOGIN, 'BAD_CREDENTIALS');
      }
      await resetFailures(profile);
      return { profile, member };
    },

    async updateProfile(pid, actor, patch) {
      const updates = {};
      if (patch.elderName !== undefined) updates.elderName = patch.elderName;
      if (patch.timezone !== undefined) updates.timezone = patch.timezone;
      if (patch.language !== undefined) updates.language = patch.language;
      if (patch.requireApproval !== undefined) updates['settings.requireApproval'] = patch.requireApproval;
      if (!Object.keys(updates).length) return api.getProfile(pid);
      const profile = await profiles().update(pid, updates);
      const summary =
        patch.requireApproval === false
          ? `${actor.name} turned off approval: family and caretaker edits now apply straight away.`
          : patch.requireApproval === true
            ? `${actor.name} turned on approval: family and caretaker edits now need their OK.`
            : `${actor.name} updated profile settings.`;
      await activity.record(pid, actor, { action: 'profile.updated', summary });
      return profile;
    },

    /** Elder invites a family member or caretaker. Returns the one-time invite code. */
    async invite(pid, actor, { name, role, email }) {
      if (!INVITABLE_ROLES.includes(role)) throw new HttpError(400, 'Role must be family or caretaker', 'VALIDATION');
      const current = await api.listMembers(pid);
      if (current.length >= MAX_MEMBERS) {
        throw new HttpError(409, `A CareCircle can have at most ${MAX_MEMBERS} people.`, 'LIMIT');
      }
      const inviteCode = randomCode(10);
      const expiresAt = iso(now() + INVITE_DAYS * 86_400_000);
      const member = await members(pid).create(newId(), {
        name,
        role,
        status: 'invited',
        email: email ?? null,
        phone: null,
        timezone: null,
        language: null,
        notify: { email: false },
        passcodeHash: null,
        tokenVersion: 1,
        invite: { codeHash: sha256(inviteCode), expiresAt },
        createdAt: iso(),
      });
      await activity.record(pid, actor, {
        action: 'member.invited',
        summary: `${actor.name} invited ${name} as ${role}.`,
        entity: 'member',
        entityId: member.id,
      });
      return { member, inviteCode, expiresAt };
    },

    /** Invited person joins with the invite code and chooses their own passcode. */
    async join({ profileCode, inviteCode, passcode, email, phone, timezone, language }) {
      const pid = normalizeProfileCode(profileCode);
      const profile = pid ? await profiles().get(pid) : null;
      if (!profile) throw new HttpError(401, 'That invite is not valid.', 'BAD_INVITE');
      assertNotLocked(profile);
      const codeHash = sha256(normalizeProfileCode(inviteCode));
      const [member] = await members(pid).list({ where: [['invite.codeHash', '==', codeHash]] });
      if (!member || member.status !== 'invited') {
        await recordFailure(profile);
        throw new HttpError(401, 'That invite is not valid.', 'BAD_INVITE');
      }
      if (Date.parse(member.invite.expiresAt) <= now()) {
        throw new HttpError(410, 'This invite has expired. Ask for a new one.', 'INVITE_EXPIRED');
      }
      assertStrong(passcode);
      await assertPasscodeUnused(pid, passcode);
      const joined = await members(pid).update(member.id, {
        status: 'active',
        email,
        phone: phone ?? null,
        timezone,
        language,
        notify: { email: true },
        passcodeHash: await hashPasscode(passcode),
        invite: null,
        joinedAt: iso(),
      });
      await activity.record(pid, joined, {
        action: 'member.joined',
        summary: `${joined.name} joined as ${joined.role}.`,
        entity: 'member',
        entityId: joined.id,
      });
      return { profile, member: joined };
    },

    /** Elder removes someone. Their sessions stop working immediately. */
    async removeMember(pid, actor, memberId) {
      const member = await members(pid).get(memberId);
      if (!member || member.status === 'removed') throw new HttpError(404, 'Person not found', 'NOT_FOUND');
      if (member.role === 'elder') throw new HttpError(400, 'The elder cannot be removed.', 'FORBIDDEN_ACTION');
      await members(pid).update(memberId, {
        status: 'removed',
        passcodeHash: null,
        invite: null,
        tokenVersion: (member.tokenVersion ?? 1) + 1,
        removedAt: iso(),
      });
      await activity.record(pid, actor, {
        action: 'member.removed',
        summary: `${actor.name} removed ${member.name}'s access.`,
        entity: 'member',
        entityId: memberId,
      });
    },

    /** A member updates their own contact details and reminder preferences. */
    async updateSelf(pid, member, patch) {
      const updates = {};
      for (const key of ['email', 'phone', 'timezone', 'language']) {
        if (patch[key] !== undefined) updates[key] = patch[key];
      }
      if (patch.notify) {
        if (patch.notify.email !== undefined) updates['notify.email'] = patch.notify.email;
      }
      if (!Object.keys(updates).length) return member;
      const updated = await members(pid).update(member.id, updates);
      await activity.record(pid, member, {
        action: 'member.updated',
        summary: `${member.name} updated their contact details.`,
        entity: 'member',
        entityId: member.id,
      });
      return updated;
    },

    /** Changing a passcode signs out the member's other sessions. */
    async changePasscode(pid, member, { currentPasscode, newPasscode }) {
      const fresh = await members(pid).get(member.id);
      if (!(await verifyPasscode(currentPasscode, fresh.passcodeHash))) {
        throw new HttpError(401, 'Your current passcode is not right.', 'BAD_CREDENTIALS');
      }
      assertStrong(newPasscode);
      await assertPasscodeUnused(pid, newPasscode, member.id);
      const updated = await members(pid).update(member.id, {
        passcodeHash: await hashPasscode(newPasscode),
        tokenVersion: (fresh.tokenVersion ?? 1) + 1,
      });
      await activity.record(pid, member, { action: 'member.passcode', summary: `${member.name} changed their passcode.` });
      return updated;
    },
  };
  return api;
}
