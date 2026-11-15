import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiClient, S, SAFETY_RULES } from '../src/ai/gemini.js';
import { createTranslator } from '../src/ai/translate.js';
import { createSpeech } from '../src/ai/speech.js';
import { createGoogleAuth } from '../src/ai/googleAuth.js';
import { createLru } from '../src/lib/lru.js';

const jsonResponse = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const geminiReply = (obj) => jsonResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

test('Gemini client sends the key in a header, the safety rules and a schema', async () => {
  let seen;
  const gemini = createGeminiClient({
    apiKey: 'k-123',
    model: 'gemini-flash-latest',
    fetchImpl: async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return geminiReply({ ok: true });
    },
  });
  const out = await gemini.generateJson({ instruction: 'Do X', text: 'data', schema: S.obj({ ok: S.bool() }) });
  assert.deepEqual(out, { ok: true });
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
  assert.ok(!seen.url.includes('k-123'), 'API key never goes in the URL');
  assert.equal(seen.init.headers['x-goog-api-key'], 'k-123');
  assert.ok(seen.body.systemInstruction.parts[0].text.startsWith(SAFETY_RULES));
  assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(seen.body.generationConfig.temperature, undefined, 'no deprecated sampling parameters');
  assert.equal(seen.body.contents[0].role, 'user', 'request does not end on a model turn');
});

test('Gemini client is off without a key', () => {
  assert.equal(createGeminiClient({ apiKey: null, model: 'm' }), null);
});

test('Gemini errors become friendly HTTP errors', async () => {
  const run = (fetchImpl) => createGeminiClient({ apiKey: 'k', model: 'm', fetchImpl }).generateJson({ instruction: 'x', schema: {} });
  await assert.rejects(run(async () => jsonResponse(429, {})), (e) => e.status === 429 && e.code === 'AI_BUSY');
  await assert.rejects(run(async () => jsonResponse(500, {})), (e) => e.status === 502);
  await assert.rejects(run(async () => { throw new Error('ECONNRESET'); }), (e) => e.status === 503 && /could not be reached/.test(e.message));
  await assert.rejects(
    run(async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }),
    (e) => e.status === 503 && /taking too long/.test(e.message),
  );
  await assert.rejects(run(async () => jsonResponse(200, { promptFeedback: { blockReason: 'SAFETY' } })), (e) => e.code === 'AI_BLOCKED');
  await assert.rejects(
    run(async () => jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'not json' }] } }] })),
    (e) => e.code === 'AI_BAD_RESPONSE',
  );
  const fenced = await run(async () => jsonResponse(200, { candidates: [{ content: { parts: [{ text: '```json\n{"a":1}\n```' }] } }] }));
  assert.deepEqual(fenced, { a: 1 });
});

test('translator batches, de-duplicates, caches and skips English', async () => {
  const requests = [];
  const translator = createTranslator({
    auth: { headers: async () => ({ 'x-goog-api-key': 'g' }) },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return jsonResponse(200, { data: { translations: body.q.map((q) => ({ translatedText: `hi:${q}` })) } });
    },
  });
  assert.deepEqual(await translator.translate(['Hello'], 'en'), ['Hello']);
  assert.equal(requests.length, 0);
  assert.deepEqual(await translator.translate(['Hello', 'Bye', 'Hello'], 'hi'), ['hi:Hello', 'hi:Bye', 'hi:Hello']);
  assert.deepEqual(requests[0].q, ['Hello', 'Bye']);
  assert.equal(requests[0].format, 'text');
  await translator.translate(['Bye'], 'hi');
  assert.equal(requests.length, 1, 'served from cache');
});

test('read-aloud uses Indian voices and caches audio', async () => {
  const requests = [];
  const speech = createSpeech({
    auth: { headers: async () => ({}) },
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return jsonResponse(200, { audioContent: Buffer.from('mp3').toString('base64') });
    },
  });
  const audio = await speech.synthesize('Time for your medicine', 'ta');
  assert.equal(audio.toString(), 'mp3');
  assert.equal(requests[0].voice.languageCode, 'ta-IN');
  assert.equal(requests[0].audioConfig.speakingRate, 0.9);
  await speech.synthesize('Time for your medicine', 'ta');
  assert.equal(requests.length, 1);
});

test('Google auth: API key header locally, cached service-account token on Cloud Run', async () => {
  assert.equal(createGoogleAuth({ apiKey: null, useMetadata: false }), null);
  assert.deepEqual(await createGoogleAuth({ apiKey: 'abc' }).headers(), { 'x-goog-api-key': 'abc' });

  let calls = 0;
  const auth = createGoogleAuth({
    useMetadata: true,
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.match(url, /metadata\.google\.internal/);
      assert.equal(init.headers['Metadata-Flavor'], 'Google');
      return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
    },
  });
  assert.deepEqual(await auth.headers(), { authorization: 'Bearer tok' });
  await auth.headers();
  assert.equal(calls, 1, 'token reused until close to expiry');
});

test('LRU evicts the least recently used entry', () => {
  const lru = createLru(2);
  lru.set('a', 1);
  lru.set('b', 2);
  lru.get('a');
  lru.set('c', 3);
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.get('a'), 1);
  assert.equal(lru.size, 2);
});

test('Gemini client retries once without the schema if the API rejects it', async () => {
  const bodies = [];
  const gemini = createGeminiClient({
    apiKey: 'k',
    model: 'm',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return bodies.length === 1 ? jsonResponse(400, { error: { message: 'Invalid schema' } }) : geminiReply({ ok: 1 });
    },
  });
  assert.deepEqual(await gemini.generateJson({ instruction: 'x', schema: S.obj({ ok: S.num() }) }), { ok: 1 });
  assert.ok(bodies[0].generationConfig.responseSchema);
  assert.equal(bodies[1].generationConfig.responseSchema, undefined);
  assert.match(bodies[1].systemInstruction.parts[0].text, /Reply with JSON only/);
});
