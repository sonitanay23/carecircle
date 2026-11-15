# Security policy

CareCircle holds health information about older people, so security and privacy are treated as core features.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **Report a vulnerability** (private advisory) on this repository. We aim to reply within 3 days.

## How data is protected

| Area               | Control                                                                                                                                                 | Where                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Passcodes          | Per-person passcodes, scrypt-hashed with a random salt; weak and common passcodes refused                                                               | `src/lib/passcode.js`                                   |
| Brute force        | Profile locks for 15 min after 5 wrong passcodes; strict rate limits on sign-in, sign-up and invites; same error for unknown profile and wrong passcode | `src/services/profiles.js`, `src/routes/api.js`         |
| Sessions           | HMAC-signed, expiring bearer tokens (no cookies, so no CSRF); token version revokes all sessions when a passcode changes or a person is removed         | `src/lib/tokens.js`, `src/middleware/auth.js`           |
| Authorisation      | Role permissions checked on every route; family and caretakers can only _suggest_ health-record changes, which the elder approves                       | `src/lib/permissions.js`, `src/services/changes.js`     |
| Email action links | Signed, single-purpose, expire after 18 h, and only act on a button press so link scanners cannot log doses                                             | `src/routes/actions.js`                                 |
| Scheduler endpoint | Shared secret compared in constant time (`timingSafeEqual`)                                                                                             | `src/routes/internal.js`                                |
| Input              | Every request body validated against a schema; JSON size limits; friendly errors with no stack traces                                                   | `src/lib/validate.js`, `src/middleware/errorHandler.js` |
| Browser            | Helmet headers, strict Content-Security-Policy (`script-src 'self'`, no inline scripts, no third-party scripts); user data inserted as text, never HTML | `src/app.js`, `public/js/ui.js`                         |
| AI                 | Gemini output is schema-checked; prompts treat uploaded text as data (prompt-injection guard); scanned medicines are drafts the person must confirm     | `src/ai/gemini.js`, `src/services/assistant.js`         |
| Secrets            | Stored in Google Secret Manager, never in the repo; `.env` is git-ignored                                                                               | `deploy.sh`                                             |
| Runtime            | Container runs as the non-root `node` user; least-privilege service account roles                                                                       | `Dockerfile`, `deploy.sh`                               |
| Public Medical ID  | Opt-in, shows only what the elder chose, revocable token, `noindex` and `no-store`                                                                      | `src/services/medicalId.js`                             |

Security behaviour is covered by automated tests in `test/security.test.js` and the API test suites, which run on every push in GitHub Actions.
