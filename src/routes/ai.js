import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { HttpError } from '../lib/httpError.js';
import { requirePermission } from '../middleware/auth.js';
import { PHOTO_TYPES } from '../services/medications.js';
import { parse, string, oneOf, optional, LANGUAGES } from '../lib/validate.js';

// The app shrinks photos before upload; this limit only guards against abuse.
const MAX_SCAN_BYTES = 10 * 1024 * 1024;

const langOf = (req) => {
  const lang = req.query.lang ?? req.body?.lang ?? req.auth.member.language ?? 'en';
  if (!LANGUAGES.includes(lang)) throw new HttpError(400, `lang must be one of: ${LANGUAGES.join(', ')}`, 'VALIDATION');
  return lang;
};

/**
 * AI helpers (Gemini), translation and read-aloud. All of them only suggest or
 * explain; saving anything still goes through the normal (approval) routes.
 */
export function aiRouter({ services, config }) {
  const { assistant, speech, translator } = services;
  const router = Router();
  const read = requirePermission('care:read');

  // AI calls cost money and time: keep a separate, tighter limit.
  const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.isProduction ? 60 : 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many AI requests. Please wait a few minutes.' } },
  });

  router.get('/ai/status', read, (_req, res) => {
    res.json({ gemini: assistant.enabled, translation: Boolean(translator), readAloud: Boolean(speech), languages: LANGUAGES });
  });

  // Photo of a prescription or medicine box -> draft medicines to review.
  router.post(
    '/ai/prescription-scan',
    requirePermission('changes:propose'),
    aiLimiter,
    express.raw({ type: Object.keys(PHOTO_TYPES), limit: MAX_SCAN_BYTES }),
    async (req, res) => {
      const contentType = req.get('content-type')?.split(';')[0];
      const signature = PHOTO_TYPES[contentType];
      if (!signature || !Buffer.isBuffer(req.body) || !signature.every((b, i) => req.body[i] === b)) {
        throw new HttpError(415, 'That photo type is not supported. Please take the photo again with the camera, or choose a JPEG or PNG.', 'UNSUPPORTED_MEDIA');
      }
      res.json(await assistant.scanPrescription(req.auth.profileId, { contentType, buffer: req.body }));
    },
  );

  router.get('/medications/:id/explanation', read, aiLimiter, async (req, res) => {
    res.json(await assistant.explainMedication(req.auth.profileId, req.params.id, langOf(req)));
  });

  router.get('/ai/interactions', read, aiLimiter, async (req, res) => {
    res.json(await assistant.checkInteractions(req.auth.profileId, langOf(req)));
  });

  router.get('/appointments/:id/visit-summary', read, aiLimiter, async (req, res) => {
    res.json(await assistant.visitSummary(req.auth.profileId, req.params.id, langOf(req)));
  });

  // Voice assistant: the browser turns speech into text, we answer from the data.
  router.post('/ai/ask', read, aiLimiter, async (req, res) => {
    const { question } = parse(req.body, { question: string({ max: 300 }), lang: optional(oneOf(LANGUAGES)) });
    res.json(await assistant.ask(req.auth.profileId, req.auth.member, { question, lang: langOf(req) }));
  });

  // Read-aloud with Cloud Text-to-Speech (Indian voices).
  router.post('/ai/speak', read, aiLimiter, async (req, res) => {
    if (!speech) throw new HttpError(503, 'Read-aloud is not switched on yet.', 'TTS_DISABLED');
    const { text } = parse(req.body, { text: string({ max: 1000 }), lang: optional(oneOf(LANGUAGES)) });
    let audio;
    try {
      audio = await speech.synthesize(text, langOf(req));
    } catch {
      throw new HttpError(502, 'Read-aloud is not working right now. Please try again.', 'TTS_ERROR');
    }
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' });
    res.send(audio);
  });

  // Translate short UI text (e.g. a medicine's instructions) into another language.
  router.post('/ai/translate', read, aiLimiter, async (req, res) => {
    if (!translator) throw new HttpError(503, 'Translation is not switched on yet.', 'TRANSLATE_DISABLED');
    const { text } = parse(req.body, { text: string({ max: 2000 }), lang: oneOf(LANGUAGES) });
    try {
      const [translated] = await translator.translate([text], req.body.lang);
      res.json({ text: translated, lang: req.body.lang });
    } catch {
      throw new HttpError(502, 'Translation is not working right now. Please try again.', 'TRANSLATE_ERROR');
    }
  });

  return router;
}
