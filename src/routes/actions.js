import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { formatForPerson, zonedToUtc } from '../lib/time.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Small server-rendered page: works from any email app, no JavaScript needed. */
const page = ({ title, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — CareCircle</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<main id="main" class="action-page">
<p class="brand">CareCircle</p>
${body}
</main>
</body>
</html>`;

/**
 * One-tap links from reminder emails ("I've taken it"). Opening the link shows
 * a confirmation button; only pressing it (a POST) records the dose. This way
 * email security scanners that open links cannot mark doses by accident.
 */
export function actionsRouter({ services, config }) {
  const router = Router();
  router.use(
    rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isProduction ? 60 : 1000, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  });

  const invalid = (res) =>
    res.status(410).send(
      page({
        title: 'Link expired',
        body: '<h1>This link has expired</h1><p class="lead">Please open CareCircle to log the dose.</p><p><a class="button" href="/">Open CareCircle</a></p>',
      }),
    );

  const describe = async (action) => {
    const profile = await services.profiles.getProfile(action.pid);
    const when = formatForPerson(zonedToUtc(action.date, action.time, profile.timezone), action.member.timezone ?? profile.timezone);
    return { label: `${action.med.name}${action.med.dose ? ` ${action.med.dose}` : ''}`, when };
  };

  router.get('/:token', async (req, res) => {
    const action = await services.reminders.resolveAction(req.params.token);
    if (!action) return invalid(res);
    const { label, when } = await describe(action);
    res.send(
      page({
        title: 'Confirm dose',
        body: `<h1>Mark ${esc(label)} as taken?</h1>
<p class="lead">Dose due ${esc(when)}.</p>
<form method="post" action="/a/${esc(req.params.token)}">
<button type="submit" class="button">Yes, it has been taken</button>
</form>
<p><a href="/">Not now — open CareCircle</a></p>`,
      }),
    );
  });

  router.post('/:token', async (req, res) => {
    const action = await services.reminders.resolveAction(req.params.token);
    if (!action) return invalid(res);
    const { label, when } = await describe(action);
    await services.doses.record(action.pid, action.member, {
      medicationId: action.med.id,
      date: action.date,
      time: action.time,
      status: 'taken',
      via: 'email',
    });
    res.send(
      page({
        title: 'Dose logged',
        body: `<h1 role="status">Done — ${esc(label)} is marked as taken</h1>
<p class="lead">Dose due ${esc(when)}. Everyone in your CareCircle can see it.</p>
<p><a class="button" href="/">Open CareCircle</a></p>`,
      }),
    );
  });

  return router;
}
