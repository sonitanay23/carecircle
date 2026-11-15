import { createHash } from 'node:crypto';
import { createLru } from '../lib/lru.js';

const API = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/** Indian English and Indian-language voices, matching the app's languages. */
export const VOICE_LOCALES = Object.freeze({
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  bn: 'bn-IN',
  mr: 'mr-IN',
  gu: 'gu-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  pa: 'pa-IN',
  ur: 'ur-IN',
});

/** Google Cloud Text-to-Speech: reads text aloud, slightly slower than normal. */
export function createSpeech({ auth, fetchImpl = fetch, logger }) {
  if (!auth) return null;
  const cache = createLru(200);

  return {
    /** @returns {Promise<Buffer>} MP3 audio */
    async synthesize(text, language = 'en') {
      const languageCode = VOICE_LOCALES[language] ?? 'en-IN';
      const key = createHash('sha256').update(`${languageCode}:${text}`).digest('hex');
      const hit = cache.get(key);
      if (hit) return hit;
      const res = await fetchImpl(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await auth.headers()) },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 0.9 },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger?.warn('tts_error', { status: res.status });
        throw new Error(`Text-to-Speech failed with ${res.status}`);
      }
      const audio = Buffer.from((await res.json()).audioContent, 'base64');
      cache.set(key, audio);
      return audio;
    },
  };
}
