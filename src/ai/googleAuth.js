/**
 * Authorises calls to Google Cloud REST APIs (Translation, Text-to-Speech).
 * On Cloud Run it uses the service account through the metadata server, so no
 * key is stored anywhere. Locally it can use an API key instead.
 */
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

export function createGoogleAuth({
  apiKey,
  useMetadata,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  if (!apiKey && !useMetadata) return null;
  let cached = null;

  async function accessToken() {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const res = await fetchImpl(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`Metadata server returned ${res.status}`);
    const body = await res.json();
    cached = { token: body.access_token, expiresAt: now() + body.expires_in * 1000 };
    return cached.token;
  }

  return {
    mode: apiKey ? 'apiKey' : 'serviceAccount',
    /** Headers to add to a Google API request. */
    async headers() {
      return apiKey
        ? { 'x-goog-api-key': apiKey }
        : { authorization: `Bearer ${await accessToken()}` };
    },
  };
}
