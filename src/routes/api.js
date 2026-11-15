import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { HttpError } from '../lib/httpError.js';
import { formatProfileCode } from '../lib/ids.js';
import { PASSCODE_MAX } from '../lib/passcode.js';
import { INVITABLE_ROLES } from '../lib/permissions.js';
import { publicMember, publicProfile } from '../services/profiles.js';
import { BLOOD_GROUPS } from '../services/medicalId.js';
import { authenticate, requirePermission, issueSession } from '../middleware/auth.js';
import { careRouter } from './care.js';
import { aiRouter } from './ai.js';
import { messages } from '../notify/messages.js';
import { qrSvg } from '../lib/qr.js';
import {
  parse,
  string,
  email,
  phone,
  timezone,
  oneOf,
  boolean,
  array,
  object,
  optional,
  number,
  LANGUAGES,
} from '../lib/validate.js';

// Passcodes are not trimmed: spaces are allowed and must match exactly.
const passcodeField = string({ min: 1, max: PASSCODE_MAX, trim: false });
const codeField = string({ max: 20 });
const nameField = string({ max: 80 });

const schemas = {
  createProfile: {
    elderName: nameField,
    email: email(),
    phone: optional(phone()),
    timezone: timezone(),
    language: oneOf(LANGUAGES),
    passcode: passcodeField,
  },
  login: { profileCode: codeField, passcode: passcodeField },
  updateProfile: {
    elderName: nameField,
    timezone: timezone(),
    language: oneOf(LANGUAGES),
    requireApproval: boolean(),
  },
  invite: { name: nameField, role: oneOf(INVITABLE_ROLES), email: optional(email()) },
  join: {
    profileCode: codeField,
    inviteCode: codeField,
    passcode: passcodeField,
    email: email(),
    phone: optional(phone()),
    timezone: timezone(),
    language: oneOf(LANGUAGES),
  },
  updateSelf: {
    email: email(),
    phone: optional(phone()),
    timezone: timezone(),
    language: oneOf(LANGUAGES),
    notify: object({ email: optional(boolean()) }),
  },
  changePasscode: { currentPasscode: passcodeField, newPasscode: passcodeField },
  sos: {
    location: optional(
      object({
        latitude: number({ min: -90, max: 90 }),
        longitude: number({ min: -180, max: 180 }),
        accuracyMeters: optional(number({ min: 0, max: 100_000 })),
      }),
    ),
    note: optional(string({ max: 300 })),
  },
  reject: { reason: optional(string({ max: 300 })) },
  medicalId: {
    bloodGroup: oneOf(BLOOD_GROUPS),
    allergies: array(string({ max: 80 }), { max: 30 }),
    conditions: array(string({ max: 80 }), { max: 30 }),
    emergencyContacts: array(object({ name: nameField, relation: string({ max: 40 }), phone: phone() }), { max: 5 }),
    notes: optional(string({ max: 500 })),
  },
};

const session = (services, profile, member) => ({
  token: issueSession(services.tokens, profile.id, member),
  profile: { ...publicProfile(profile), code: formatProfileCode(profile.id) },
  me: publicMember(member),
});

/** Changes that need approval return 202 Accepted; applied changes return 200. */
const sendChangeResult = (res, outcome, body) =>
  res.status(outcome.status === 'pending' ? 202 : 200).json({ status: outcome.status, change: outcome.change, ...body });

export function apiRouter({ services, config }) {
  const { profiles, changes, activity, medicalId } = services;
  const router = Router();

  // Tighter limits on endpoints that check passcodes or invite codes.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.isProduction ? 20 : 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' } },
  });

  // ---------- Public endpoints (no passcode) ----------

  router.post('/profiles', authLimiter, async (req, res) => {
    const input = parse(req.body, schemas.createProfile);
    const { profile, member } = await profiles.createProfile(input);
    res.status(201).json(session(services, profile, member));
  });

  router.post('/sessions', authLimiter, async (req, res) => {
    const input = parse(req.body, schemas.login);
    const { profile, member } = await profiles.login(input);
    res.json(session(services, profile, member));
  });

  router.post('/members/join', authLimiter, async (req, res) => {
    const input = parse(req.body, schemas.join);
    const { profile, member } = await profiles.join(input);
    res.status(201).json(session(services, profile, member));
  });

  router.get('/public/medical-id/:token', authLimiter, async (req, res) => {
    const card = await medicalId.publicView(req.params.token, profiles);
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.json(card);
  });

  // ---------- Everything below needs a signed-in member ----------

  router.use(authenticate(services));

  router.get('/me', async (req, res) => {
    const profile = await profiles.getProfile(req.auth.profileId);
    res.json({ profile: { ...publicProfile(profile), code: formatProfileCode(profile.id) }, me: publicMember(req.auth.member) });
  });

  router.patch('/me', async (req, res) => {
    const patch = parse(req.body, schemas.updateSelf, { partial: true });
    const updated = await profiles.updateSelf(req.auth.profileId, req.auth.member, patch);
    res.json({ me: publicMember(updated) });
  });

  router.post('/me/passcode', async (req, res) => {
    const input = parse(req.body, schemas.changePasscode);
    const updated = await profiles.changePasscode(req.auth.profileId, req.auth.member, input);
    res.json({ token: issueSession(services.tokens, req.auth.profileId, updated) });
  });

  router.patch('/profile', requirePermission('profile:update'), async (req, res) => {
    const patch = parse(req.body, schemas.updateProfile, { partial: true });
    const profile = await profiles.updateProfile(req.auth.profileId, req.auth.member, patch);
    res.json({ profile: { ...publicProfile(profile), code: formatProfileCode(profile.id) } });
  });

  // Members
  router.get('/members', requirePermission('members:read'), async (req, res) => {
    const list = await profiles.listMembers(req.auth.profileId);
    res.json({ members: list.map(publicMember) });
  });

  router.post('/members/invites', requirePermission('members:manage'), async (req, res) => {
    const input = parse(req.body, schemas.invite);
    const { member, inviteCode, expiresAt } = await profiles.invite(req.auth.profileId, req.auth.member, input);
    res.status(201).json({
      member: publicMember(member),
      inviteCode: `${inviteCode.slice(0, 5)}-${inviteCode.slice(5)}`,
      profileCode: formatProfileCode(req.auth.profileId),
      expiresAt,
      joinUrl: `${config.appBaseUrl}/join?profile=${formatProfileCode(req.auth.profileId)}`,
    });
  });

  router.delete('/members/:memberId', requirePermission('members:manage'), async (req, res) => {
    await profiles.removeMember(req.auth.profileId, req.auth.member, req.params.memberId);
    res.status(204).end();
  });

  // Change approvals
  router.get('/changes', requirePermission('changes:read'), async (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !['pending', 'approved', 'rejected', 'applied', 'withdrawn', 'failed'].includes(status)) {
      throw new HttpError(400, 'Unknown status filter', 'VALIDATION');
    }
    res.json({ changes: await changes.list(req.auth.profileId, { status }) });
  });

  router.post('/changes/:changeId/approve', requirePermission('changes:review'), async (req, res) => {
    const { change } = await changes.approve(req.auth.profileId, req.auth.member, req.params.changeId);
    res.json({ change });
  });

  router.post('/changes/:changeId/reject', requirePermission('changes:review'), async (req, res) => {
    const { reason } = parse(req.body ?? {}, schemas.reject);
    res.json({ change: await changes.reject(req.auth.profileId, req.auth.member, req.params.changeId, reason) });
  });

  router.post('/changes/:changeId/withdraw', requirePermission('changes:propose'), async (req, res) => {
    res.json({ change: await changes.withdraw(req.auth.profileId, req.auth.member, req.params.changeId) });
  });

  // Activity log
  router.get('/activity', requirePermission('activity:read'), async (req, res) => {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new HttpError(400, 'limit must be a whole number from 1 to 200', 'VALIDATION');
    }
    const before = typeof req.query.before === 'string' && req.query.before.length <= 64 ? req.query.before : undefined;
    res.json({ activity: await activity.list(req.auth.profileId, { limit, before }) });
  });

  // Medical ID
  router.get('/medical-id', requirePermission('medicalId:read'), async (req, res) => {
    res.json({ medicalId: await medicalId.get(req.auth.profileId) });
  });

  router.put('/medical-id', requirePermission('changes:propose'), async (req, res) => {
    const data = parse(req.body, schemas.medicalId);
    const outcome = await medicalId.propose(req.auth.profileId, req.auth.member, { notes: '', ...data });
    sendChangeResult(res, outcome, { medicalId: await medicalId.get(req.auth.profileId) });
  });

  // QR code for the emergency link, to print or keep on the phone's lock screen.
  router.get('/medical-id/qr.svg', requirePermission('medicalId:read'), async (req, res) => {
    const { sharing } = await medicalId.get(req.auth.profileId);
    if (!sharing.enabled) throw new HttpError(404, 'Turn on the medical ID link first.', 'NOT_SHARED');
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store' });
    res.send(qrSvg(sharing.url, { label: 'QR code for the medical ID link' }));
  });

  router.post('/medical-id/sharing', requirePermission('medicalId:share'), async (req, res) => {
    res.json({ medicalId: await medicalId.enableSharing(req.auth.profileId, req.auth.member) });
  });

  router.delete('/medical-id/sharing', requirePermission('medicalId:share'), async (req, res) => {
    res.json({ medicalId: await medicalId.disableSharing(req.auth.profileId, req.auth.member) });
  });

  // Notifications: what was sent to whom, and a test message to check setup.
  router.get('/notifications', requirePermission('activity:read'), async (req, res) => {
    res.json({ notifications: await services.notifier.history(req.auth.profileId) });
  });

  router.post('/notifications/test', authLimiter, async (req, res) => {
    const me = req.auth.member;
    if (!services.notifier.routesFor(me).length) {
      throw new HttpError(400, 'Add an email address and turn on email reminders first.', 'NO_CHANNEL');
    }
    const result = await services.notifier.send(req.auth.profileId, {
      id: `test_${me.id}_${services.now()}`,
      kind: 'test',
      recipients: [me],
      build: (recipient) => messages.test({ recipient }),
    });
    if (!result.sent) throw new HttpError(502, 'The test message could not be sent. Please check the email settings.', 'SEND_FAILED');
    res.json({ sent: result.sent });
  });

  // SOS: emails everyone else in the circle at once. Any member can raise it.
  router.post('/sos', authLimiter, async (req, res) => {
    const input = parse(req.body ?? {}, schemas.sos);
    const result = await services.sos.trigger(req.auth.profileId, req.auth.member, input);
    res.status(result.status === 'sent' ? 201 : 200).json(result);
  });

  // Gemini helpers, translation and read-aloud
  router.use(aiRouter({ services, config }));

  // Medicines, doses, appointments and health readings
  router.use(careRouter({ services }));

  return router;
}
