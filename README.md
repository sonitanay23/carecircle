# CareCircle

[![CI](https://github.com/sonitanay23/carecircle/actions/workflows/ci.yml/badge.svg)](https://github.com/sonitanay23/carecircle/actions/workflows/ci.yml) ![Tests](https://img.shields.io/badge/tests-147%20passing-brightgreen) ![Coverage](https://img.shields.io/badge/coverage-98.5%25-brightgreen) ![Node](https://img.shields.io/badge/node-22-blue) ![License](https://img.shields.io/badge/license-MIT-blue)

**Live:** https://carecircle-dqjzfm3zpq-el.a.run.app

**Medicines and care, together — with the elder in charge.**

CareCircle is a shared healthcare management platform for elderly people, their family and their caretakers. Everyone works from one healthcare profile, protected by a passcode, to manage medication schedules, track adherence and keep on top of doctor appointments. Reminders go out automatically by **email**, with one-tap "I've taken it" links.

Built for the PromptWars _Catalyst_ challenge: Elderly Care & Medication Management Platform.

## Why it is more than a reminder app

| Idea                     | What it does                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Elder approves changes   | Edits by family or caretakers stay _pending_ until the elder approves them.                |
| Activity log             | Every change is recorded: who changed what, and when.                                      |
| Escalating reminders     | Upcoming dose → missed dose to the elder → still missed, escalate to family.               |
| One-tap "I've taken it"  | The elder or caretaker confirms a dose straight from the reminder email.                   |
| Prescription scan        | Photograph a prescription or pill box; Gemini drafts the schedule for a person to confirm. |
| Plain-language medicines | Gemini explains each medicine simply and flags possible clashes as "ask your doctor".      |
| Refill tracker           | Pill counts go down as doses are taken, with "running low" alerts.                         |
| Medical ID with QR code  | Allergies, blood group, current medicines and emergency contacts for paramedics.           |
| Pre-visit summary        | The day before an appointment, a one-page adherence report and questions for the doctor.   |
| Languages & read-aloud   | Instructions translated and spoken aloud (e.g. Hindi, Tamil).                              |
| Time-zone aware          | Each person gets reminders in their own local time (family abroad).                        |
| Calendar & Maps          | "Add to Google Calendar" and directions to the clinic for every appointment.               |
| Voice assistant          | Ask "Did I take my BP tablet today?" and get a spoken answer from the dose log.            |
| Pill photos              | A photo on each medicine so the elder can recognise the right tablet without reading.      |
| SOS button               | One tap emails every family member, with the elder's location.                             |
| Health readings          | Log blood pressure and sugar, see trends, share them with the doctor (no AI advice).       |
| Works offline            | Installable app (PWA) that shows today's doses even without internet.                      |

Health readings outside common general reference ranges are marked _worth mentioning to your doctor_; CareCircle never interprets them. CareCircle never gives dosage advice or diagnoses. AI output is always reviewed by a person and marked as _check with your doctor_.

## Google Cloud services

- **Cloud Run** — hosting (containerised, scales to zero)
- **Firestore** — profiles, medications, dose log, appointments, activity log
- **Cloud Scheduler** — triggers the reminder engine every few minutes
- **Gemini API** — prescription scan, plain-language explanations, interaction flags, pre-visit summaries, voice-assistant answers (structured JSON output, REST, no SDK)
- **Cloud Translation** — every reminder email in the reader's language (11 Indian languages + English), cached
- **Cloud Text-to-Speech** — read-aloud in Indian voices (`en-IN`, `hi-IN`, `ta-IN`…), slightly slower for older listeners
- Translation and Text-to-Speech authenticate with the Cloud Run **service account** via the metadata server, so no keys are stored
- **Secret Manager** — API keys and tokens
- **Cloud Logging & Error Reporting** — structured JSON logs from stdout
- **Google Calendar & Maps links** — appointment integration

## Build plan

- [x] **Step 1 — Scaffold:** Express server, security headers (Helmet + CSP), rate limiting, structured logging, error handling, health check, Dockerfile, tests
- [x] **Step 2 — Access & control:** profiles, per-person passcodes (scrypt, lockout after 5 wrong tries), invites, roles, elder approval of changes, activity log, medical ID with revocable share link
- [x] **Step 3 — Care records:** medicines with schedules and pill photos, today's doses in the elder's time zone, dose log (idempotent, tracks late doses), adherence and streaks, refill tracking with days-left, appointments with Google Calendar/Maps links, health readings
- [x] **Step 4 — Reminders:** Cloud Scheduler-triggered engine; email for upcoming, missed and escalated doses, appointments (day before + 2 hours before), low stock, changes awaiting the elder, and a Sunday weekly summary; each person's own time zone; one-tap "I've taken it" links; at-most-once delivery with retry; SOS alert API
- [x] **Step 5 — AI & languages:** Gemini prescription scan (Indian 1-0-1 / BD / TDS shorthand → times, drafts only), plain-language medicine explanations, interaction flags as "ask your doctor", pre-visit summary (also in the day-before email), grounded voice-assistant answers; Cloud Translation of every reminder email into each person's language; Cloud Text-to-Speech read-aloud in Indian voices
- [x] **Step 6 — App:** accessible no-build web app (Today with one-tap dose buttons, medicines with scan/explain/refill/photos, appointments with Google links and visit summary, health readings chart, family & approvals, medical ID with QR code, SOS with location, voice questions, read-aloud), installable and works offline
- [x] **Step 7 — Deploy:** one script (`deploy.sh`) sets up Firestore, Secret Manager, least-privilege IAM, Cloud Run and Cloud Scheduler

## Deploy to Google Cloud

```bash
PROJECT_ID=your-project ./deploy.sh
```

The script is safe to re-run. It turns on the APIs, creates the Firestore database, stores the Gemini key, Gmail app password, session secret and scheduler secret in **Secret Manager**, gives the Cloud Run service account only the roles it needs, deploys with `gcloud run deploy --source .`, and creates the **Cloud Scheduler** job that calls the reminder engine every 5 minutes.

## Run locally

Requires Node.js 22+.

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:8080
npm test
npm run lint
npm run test:coverage
```

GitHub Actions runs lint, all unit/API tests with coverage, a production dependency audit and the Playwright browser tests on every push (`.github/workflows/ci.yml`).

| Suite                | What it covers                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 147 unit + API tests | Schedules and time zones, dose logging, adherence, elder approval flow, reminders (upcoming, missed, escalation, idempotency, retries), email content, permissions, passcode lockout, token revocation, input validation, QR encoder, AI parsing and fallbacks |
| 5 Playwright tests   | Elder and family journeys at phone size, text-size and contrast modes, keyboard focus, labelled controls                                                                                                                                                       |

Coverage (`node --experimental-test-coverage`): **98.5% lines, 90% branches, 95% functions**.

## Project layout

```
src/
  app.js              Express app factory (dependencies injected for testing)
  server.js           Entry point, graceful shutdown for Cloud Run
  config.js           Validated environment configuration
  lib/                Logger, error types
  middleware/         Request id, request logging, error handling
  routes/             HTTP routes
public/               Accessible frontend (large text, high contrast, keyboard friendly)
test/                 node:test suites
```

## Data model (Firestore)

```
profiles/{profileCode}                 elder name, time zone, language, settings, lockout state
  members/{memberId}                   elder, family and caretakers (role, contact, passcode hash)
  changes/{changeId}                   suggested edits waiting for the elder (pending/approved/rejected)
  activity/{entryId}                   who did what, and when
  medications/{medicationId}           name, dose, schedule (local times + weekdays), stock
  photos/{medicationId}                pill photo (≤512 KB, type checked by file signature)
  doses/{medId_date_time}              taken / skipped / missed, who logged it, via the app or an email link
  appointments/{appointmentId}         doctor visits (stored in local time and UTC)
  readings/{readingId}                 blood pressure, sugar, pulse, SpO2, temperature, weight
  medical/card                         medical ID card
medicalIdShares/{sha256(token)}        lookup for the public medical ID link
```

## API

| Method         | Path                                                              | Who                                                             |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| POST           | `/api/profiles`                                                   | Anyone: create a CareCircle (becomes the elder)                 |
| POST           | `/api/sessions`                                                   | Sign in with profile code + own passcode                        |
| POST           | `/api/members/join`                                               | Invited person joins with invite code                           |
| GET/PATCH      | `/api/me`, POST `/api/me/passcode`                                | Any member                                                      |
| PATCH          | `/api/profile`                                                    | Elder (e.g. turn approval on/off)                               |
| GET            | `/api/members`                                                    | Any member                                                      |
| POST           | `/api/members/invites`, DELETE `/api/members/:id`                 | Elder                                                           |
| GET            | `/api/changes?status=pending`                                     | Any member                                                      |
| POST           | `/api/changes/:id/approve` and `/reject`                          | Elder                                                           |
| POST           | `/api/changes/:id/withdraw`                                       | Person who suggested it                                         |
| GET            | `/api/activity`                                                   | Any member                                                      |
| GET/PUT        | `/api/medical-id`                                                 | Any member (non-elder edits need approval → `202`)              |
| POST/DELETE    | `/api/medical-id/sharing`                                         | Elder                                                           |
| GET            | `/api/public/medical-id/:token`                                   | Public (emergency view, not cached or indexed)                  |
| GET/POST       | `/api/medications`, PATCH/DELETE `/api/medications/:id`           | Any member (non-elder changes need approval)                    |
| POST           | `/api/medications/:id/refill`                                     | Any member                                                      |
| PUT/GET/DELETE | `/api/medications/:id/photo`                                      | Any member (raw JPEG/PNG/WebP body)                             |
| GET            | `/api/doses/today`, `/api/doses?from&to`, `/api/adherence?days=7` | Any member                                                      |
| POST           | `/api/doses`                                                      | Any member: log taken / skipped                                 |
| GET/POST       | `/api/appointments`, PATCH/DELETE `/api/appointments/:id`         | Any member (non-elder changes need approval)                    |
| POST           | `/api/appointments/:id/attended`                                  | Any member                                                      |
| GET/POST       | `/api/readings`, DELETE `/api/readings/:id`                       | Any member                                                      |
| GET            | `/api/notifications`                                              | Any member: what was sent to whom                               |
| POST           | `/api/notifications/test`                                         | Any member: send yourself a test message                        |
| POST           | `/api/sos`                                                        | Any member: email everyone else at once, with optional location |
| GET            | `/api/ai/status`                                                  | Which AI features are on                                        |
| POST           | `/api/ai/prescription-scan`                                       | Photo → draft medicines (raw JPEG/PNG/WebP, ≤4 MB)              |
| GET            | `/api/medications/:id/explanation?lang=hi`                        | Plain-language explanation                                      |
| GET            | `/api/ai/interactions`                                            | Possible clashes, as "ask your doctor"                          |
| GET            | `/api/appointments/:id/visit-summary`                             | Summary + questions for the doctor                              |
| POST           | `/api/ai/ask`                                                     | Voice assistant question → short answer                         |
| POST           | `/api/ai/speak`                                                   | Text → MP3 (read-aloud)                                         |
| POST           | `/api/ai/translate`                                               | Short text → another language                                   |
| POST           | `/internal/reminders/run`                                         | Cloud Scheduler only (`X-Cron-Secret`)                          |
| GET/POST       | `/a/:token`                                                       | One-tap email action (confirm page, then record)                |

## AI safety

- Gemini only ever **suggests**: scanned prescriptions come back as drafts that a person checks and saves through the normal approval flow. Anything Gemini was unsure about is marked "Please check this one carefully".
- Phone photos (often 3–12 MB, or HEIC on iPhones) are resized and converted to a ~300 KB JPEG in the browser before upload, so scanning is fast on mobile data. The prompt understands handwritten Indian prescriptions: brand names, Tab./Cap./Syp., 1-0-1 / BD / TDS / HS / SOS, ½ tablet, AC/PC and durations like "x 5 days" or "1/12".
- Every request carries fixed safety rules: plain language, no diagnoses, never start/stop/change a dose, always "check with your doctor or pharmacist", emergency signs → call emergency services.
- Images and user data are treated as **information, not instructions** (prompt-injection guard).
- Gemini gets only what each task needs: no names, emails or phone numbers.
- Responses use a JSON schema and are **validated and cleaned** before use (invalid times dropped, unknown forms normalised, concerns about medicines not on the list discarded).
- Stable answers (explanations, interaction checks, visit summaries) are cached in Firestore; AI endpoints have their own rate limit.

## Reminders

Cloud Scheduler calls `POST /internal/reminders/run` every 5 minutes with an `X-Cron-Secret` header. Each run checks every CareCircle:

| When                                       | Who is told                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 10 min before a dose                       | Elder and caretakers, with a one-tap **I've taken it** link                                                  |
| Dose not logged 60 min after its time      | Elder and caretakers                                                                                         |
| Still not taken 60 min after that          | Family (escalation), with a call button                                                                      |
| Day before / 2 hours before an appointment | Everyone, with directions and an Add to Google Calendar link                                                 |
| Medicine running low                       | Everyone, with a "find a pharmacy" link                                                                      |
| A family member suggests a change          | Elder, to approve or say no                                                                                  |
| Sunday 6 pm (elder's time)                 | Everyone: weekly adherence summary                                                                           |
| Someone creates or joins a CareCircle      | That person: a welcome email with their CareCircle code, so it is never lost (the passcode is never emailed) |

- Times in each message are shown in the **recipient's own time zone** (and the elder's, if different).
- Every message is recorded in a notification ledger whose id acts as a lock, so overlapping runs never send twice; if every delivery fails the lock is released and the next run retries.
- One-tap links are signed, expire after 18 hours, stop working if the person's access is removed, and only record the dose on a button press (so email link scanners cannot log doses).
- Doses older than 12 hours are marked missed silently, so a first deploy never floods inboxes.

## Accessibility

Designed for people in their 70s first, and checked automatically in a real browser at phone size:

- **One thing at a time**: Today opens with a single card for the next medicine and one large "I've taken it" button; the rest of the day is grouped as Morning / Afternoon / Evening / Night
- **Four tabs only** (Today, Medicines, Visits, More) and a single red **Help** button in the header
- **Tap, don't type**: medicine times are big "Morning 8 am / Evening 8 pm / Bedtime" buttons, food is "Before / After / With food"; rarely used fields are folded under "More details"
- Plain words everywhere ("I bought more", "Not taken yet · was due at 8 am"), calm warm colours, line icons that look the same on every phone

- 20px base text with **Normal / Large / Extra large** sizes, **High contrast** mode and dark mode; all text and controls meet WCAG AA contrast (4.5:1+) in every theme, and the tabs stay a fixed size so nothing is cut off at the largest text
- Every button and touch target is at least 44px tall; the main dose buttons are bigger still
- Status never relies on colour alone (✓ Taken, ! Missed, ○ Later); charts come with a data table
- Skip link, one `<h1>` per screen, focus moves to the heading on each new screen, live regions announce results, and every field has a visible label and hint
- Works with keyboard only, `prefers-reduced-motion`, and screen readers; dialogs use native `<dialog>`
- Read-aloud (Cloud Text-to-Speech, Indian voices) and voice questions for people who find reading or typing hard

## Front end

Plain ES modules in `public/` (no build step, no third-party scripts), so it runs under a strict Content-Security-Policy (`script-src 'self'`). User data is always inserted as text, never as HTML. A service worker caches the app and the latest "today" list and medicines so the elder can see what to take when offline; signing out clears that saved data. The medical ID QR code is generated by a small built-in encoder (`src/lib/qr.js`) and verified with a QR scanner.

## Testing

```bash
npm test            # unit + API tests (node:test, in-memory store, fake email and AI)
npm run test:e2e    # browser tests with Playwright: elder + family journeys, accessibility checks
                    # first time: npx playwright install chromium
npm run lint
```

## Security

- Helmet security headers with a strict Content-Security-Policy
- Every person has their own passcode, hashed with scrypt; weak passcodes (123456, 111111) are refused
- Sign-in locks for 15 minutes after 5 wrong passcodes; unknown profiles give the same error as wrong passcodes
- Signed, expiring session tokens sent as `Bearer` headers (no cookies, so no CSRF); removing a person or changing a passcode ends their sessions at once
- Role checks on every route; family and caretakers can only suggest health-record changes
- Stricter rate limits on sign-in, sign-up and invite endpoints
- JSON body size limit; errors never expose stack traces to clients
- Container runs as a non-root user; secrets come from Secret Manager, never from the repo

See [SECURITY.md](SECURITY.md) for the full list of controls and how to report a vulnerability.
