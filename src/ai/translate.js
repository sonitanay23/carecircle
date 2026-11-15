import { createLru } from '../lib/lru.js';

const API = 'https://translation.googleapis.com/language/translate/v2';

/**
 * Google Cloud Translation (v2). Batches strings in one request and caches
 * results, because reminder texts repeat a lot.
 */
export function createTranslator({ auth, fetchImpl = fetch, logger }) {
  if (!auth) return null;
  const cache = createLru(2000);

  return {
    /** @returns {Promise<string[]>} translations in the same order */
    async translate(texts, target) {
      if (!target || target === 'en') return texts;
      const out = texts.map((t) => (t ? cache.get(`${target}:${t}`) : t));
      const missing = [...new Set(texts.filter((t, i) => t && out[i] === undefined))];
      if (missing.length) {
        const res = await fetchImpl(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await auth.headers()) },
          body: JSON.stringify({ q: missing, target, source: 'en', format: 'text' }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          logger?.warn('translate_error', { status: res.status });
          throw new Error(`Translation failed with ${res.status}`);
        }
        const { data } = await res.json();
        missing.forEach((t, i) => cache.set(`${target}:${t}`, data.translations[i].translatedText));
      }
      return texts.map((t) => (t ? cache.get(`${target}:${t}`) : t));
    },
  };
}
