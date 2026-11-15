import { api } from '../api.js';
import { h, add, busy, announce, timeLabel, dialog, field } from '../ui.js';
import { icon, partOfDay } from '../icons.js';
import { speak, listen, canListen } from '../voice.js';

const STATUS = {
  taken: { label: 'Taken', className: 'pill-done', mark: '✓' },
  skipped: { label: 'Skipped', className: 'pill-skipped', mark: '–' },
  missed: { label: 'Not taken', className: 'pill-missed', mark: '!' },
  due: { label: 'Take now', className: 'pill-due', mark: '●' },
  upcoming: { label: 'Later', className: 'pill-later', mark: '○' },
};

const greeting = () => {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
};

/** Relative wording for the hero card: "in 2 hours", "in 15 minutes". */
function inHowLong(iso) {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (mins <= 1) return 'now';
  if (mins < 60) return `in ${mins} minutes`;
  const hrs = Math.round(mins / 60);
  return `in about ${hrs} hour${hrs > 1 ? 's' : ''}`;
}

function photoFor(medicationId, hasPhoto, name) {
  if (!hasPhoto) return h('span', { class: 'pill-icon' }, icon('pill'));
  const img = h('img', { class: 'pill-photo', alt: `Photo of ${name}`, width: 72, height: 72 });
  api(`/api/medications/${medicationId}/photo`, { as: 'blob' })
    .then((blob) => {
      img.src = URL.createObjectURL(blob);
    })
    .catch(() => img.replaceWith(h('span', { class: 'pill-icon' }, icon('pill'))));
  return img;
}

async function askQuestion(ctx) {
  const lang = ctx.me.language ?? 'en';
  const input = field({
    label: 'Your question',
    name: 'q',
    hint: 'For example: "Did I take my BP tablet today?"',
  });
  const answer = h('p', { class: 'answer', role: 'status', 'aria-live': 'polite' });
  const run = async (question) => {
    if (!question.trim()) return;
    answer.textContent = 'Thinking…';
    try {
      const r = await api('/api/ai/ask', { method: 'POST', body: { question, lang } });
      answer.textContent = r.answer;
      speak(r.answer, lang).catch(() => {});
    } catch (err) {
      answer.textContent = err.message;
    }
  };
  const mic = canListen()
    ? h(
        'button',
        {
          type: 'button',
          class: 'button primary huge',
          onclick: (e) =>
            busy(e.currentTarget, async () => {
              try {
                answer.textContent = 'Listening… please speak now.';
                const heard = await listen(lang);
                input.control.value = heard;
                await run(heard);
              } catch (err) {
                answer.textContent = err.message;
              }
            }),
        },
        icon('mic'),
        'Tap and speak',
      )
    : null;
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (e) => {
        e.preventDefault();
        run(input.control.value);
      },
    },
    input,
    h('button', { type: 'submit', class: 'button secondary block' }, 'Ask'),
  );
  await dialog({
    title: 'Ask a question',
    body: h(
      'div',
      { class: 'stack' },
      mic,
      mic && h('p', { class: 'muted' }, 'Or type it:'),
      form,
      answer,
    ),
  });
}

export async function renderToday(main, ctx) {
  const [today, adherence, meds, pending] = await Promise.all([
    api('/api/doses/today'),
    api('/api/adherence?days=7').catch(() => null),
    api('/api/medications').catch(() => ({ medications: [] })),
    ctx.me.role === 'elder'
      ? api('/api/changes?status=pending').catch(() => ({ changes: [] }))
      : { changes: [] },
  ]);
  const isElder = ctx.me.role === 'elder';
  const first = ctx.profile.elderName.split(' ')[0];
  const doses = today.doses;
  const taken = doses.filter((d) => d.status === 'taken').length;
  const hasPhoto = new Set(meds.medications.filter((m) => m.hasPhoto).map((m) => m.id));
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const yourTime = (d) =>
    viewerTz !== today.timezone
      ? ` (${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(d.scheduledAt))} your time)`
      : '';

  const record = (d, status, button) =>
    busy(button, async () => {
      try {
        await api('/api/doses', {
          method: 'POST',
          body: { medicationId: d.medicationId, date: d.date, time: d.time, status },
        });
        announce(
          status === 'taken'
            ? `Well done. ${d.name} is marked as taken.`
            : `${d.name} marked as ${status === 'skipped' ? 'not taken' : status}.`,
        );
        ctx.refresh();
      } catch (err) {
        announce(err.message, { kind: 'error' });
      }
    });

  add(
    main,
    h('h1', { tabindex: '-1' }, isElder ? `${greeting()}, ${first}` : `${first}'s medicines today`),
    h(
      'p',
      { class: 'date-line' },
      new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(
        new Date(),
      ),
    ),
    today.__offline
      ? h(
          'div',
          { class: 'banner warn', role: 'status' },
          icon('warning'),
          h('p', {}, 'No internet right now. This is the list saved on your phone.'),
        )
      : null,
    pending.changes.length
      ? h(
          'div',
          { class: 'banner info' },
          icon('bell'),
          h(
            'p',
            {},
            h(
              'a',
              { href: '#/circle' },
              `Your family suggested ${pending.changes.length} change${pending.changes.length > 1 ? 's' : ''}. Tap to check.`,
            ),
          ),
        )
      : null,
  );

  // ---- The one thing to do now ----
  const due = doses.find((d) => d.status === 'due');
  const missed = [...doses].reverse().find((d) => d.status === 'missed');
  const upcoming = doses.find((d) => d.status === 'upcoming');
  const next = due ?? missed ?? upcoming;

  if (!meds.medications.length) {
    add(
      main,
      h(
        'section',
        { class: 'hero hero-done', 'aria-labelledby': 'hero-h' },
        h('span', { class: 'pill-icon', style: 'margin: 0 auto' }, icon('pill')),
        h('h2', { id: 'hero-h' }, 'No medicines added yet'),
        h('p', { class: 'big' }, 'Add your medicines and CareCircle will remind you.'),
        h(
          'a',
          { class: 'button primary huge', href: '#/medicines' },
          icon('plus'),
          'Add medicines',
        ),
      ),
    );
  } else if (next) {
    const state = next.status === 'due' ? 'is-due' : next.status === 'missed' ? 'is-missed' : '';
    const label =
      next.status === 'due'
        ? isElder
          ? 'Time for your medicine'
          : `Time for ${first}'s medicine`
        : next.status === 'missed'
          ? `Not taken yet · was due at ${timeLabel(next.time)}`
          : `Next medicine · ${inHowLong(next.scheduledAt)}`;
    add(
      main,
      h(
        'section',
        { class: `hero ${state}`, 'aria-labelledby': 'hero-h' },
        h(
          'p',
          { class: 'hero-label' },
          icon(next.status === 'missed' ? 'warning' : 'clock'),
          label,
        ),
        h(
          'div',
          { class: 'hero-med' },
          photoFor(next.medicationId, hasPhoto.has(next.medicationId), next.name),
          h(
            'div',
            {},
            h(
              'h2',
              { id: 'hero-h', class: 'hero-name' },
              next.name,
              next.dose ? ` ${next.dose}` : '',
            ),
            next.status === 'missed'
              ? null
              : h('p', { class: 'hero-time' }, timeLabel(next.time), yourTime(next)),
            next.instructions ? h('p', { class: 'hero-note' }, next.instructions) : null,
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'button primary huge',
            onclick: (e) => record(next, 'taken', e.currentTarget),
          },
          icon('check', { size: 28 }),
          isElder ? "I've taken it" : 'Mark as taken',
        ),
        h(
          'div',
          { class: 'button-row', style: 'justify-content:center;margin-bottom:0' },
          h(
            'button',
            {
              type: 'button',
              class: 'button quiet',
              onclick: (e) => record(next, 'skipped', e.currentTarget),
            },
            'Skip this dose',
          ),
        ),
      ),
    );
  } else {
    add(
      main,
      h(
        'section',
        { class: 'hero hero-done', 'aria-labelledby': 'hero-h' },
        icon('check'),
        h('h2', { id: 'hero-h' }, doses.length ? 'All done for today' : 'Nothing to take today'),
        h(
          'p',
          { class: 'big' },
          doses.length
            ? isElder
              ? 'Well done! Every medicine is taken.'
              : `${first} has taken every medicine today.`
            : 'No medicines are scheduled for today.',
        ),
      ),
    );
  }

  // ---- Progress ----
  if (doses.length) {
    const pct = Math.round((taken / doses.length) * 100);
    const streak = adherence?.streakDays > 1 ? ` · ${adherence.streakDays} days in a row` : '';
    add(
      main,
      h(
        'div',
        { class: 'progress' },
        h(
          'p',
          { class: 'progress-text', id: 'progress-label' },
          `${taken} of ${doses.length} taken today${streak}`,
        ),
        h(
          'div',
          {
            class: 'progress-bar',
            role: 'progressbar',
            'aria-labelledby': 'progress-label',
            'aria-valuemin': '0',
            'aria-valuemax': String(doses.length),
            'aria-valuenow': String(taken),
          },
          h('span', { style: `width:${pct}%` }),
        ),
      ),
    );
  }

  // ---- The whole day, grouped the way people think about it ----
  const groups = new Map();
  for (const d of doses) {
    const part = partOfDay(d.time);
    if (!groups.has(part.key)) groups.set(part.key, { part, items: [] });
    groups.get(part.key).items.push(d);
  }
  for (const { part, items } of groups.values()) {
    const id = `group-${part.key}`;
    add(
      main,
      h(
        'section',
        { class: 'day-group', 'aria-labelledby': id },
        h('h2', { id }, icon(part.icon), part.label),
        h(
          'ul',
          { class: 'plain-list' },
          items.map((d) => {
            const st = STATUS[d.status];
            const who =
              d.record &&
              d.record.recordedBy.id !== 'system' &&
              d.record.recordedBy.id !== ctx.me.id
                ? ` · by ${d.record.recordedBy.name}`
                : '';
            return h(
              'li',
              { class: `dose-row status-${d.status}` },
              h('p', { class: 'name' }, d.name, d.dose ? ` ${d.dose}` : ''),
              h(
                'p',
                { class: 'meta' },
                timeLabel(d.time),
                yourTime(d),
                d.instructions ? ` · ${d.instructions}` : '',
              ),
              h(
                'div',
                { class: 'actions' },
                h(
                  'span',
                  { class: `pill ${st.className}` },
                  h('span', { 'aria-hidden': 'true' }, st.mark),
                  st.label,
                  d.record?.late ? ' (late)' : '',
                  who,
                ),
                d.status === 'taken'
                  ? h(
                      'button',
                      {
                        type: 'button',
                        class: 'button quiet small',
                        onclick: (e) => record(d, 'skipped', e.currentTarget),
                        'aria-label': `Change ${d.name} at ${timeLabel(d.time)} to not taken`,
                      },
                      'Undo',
                    )
                  : h(
                      'button',
                      {
                        type: 'button',
                        class: 'button secondary small',
                        onclick: (e) => record(d, 'taken', e.currentTarget),
                        'aria-label': `Mark ${d.name} at ${timeLabel(d.time)} as taken`,
                      },
                      icon('check', { size: 20 }),
                      'Taken',
                    ),
              ),
            );
          }),
        ),
      ),
    );
  }

  // ---- When-needed medicines ----
  const prn = meds.medications.filter((m) => m.asNeeded);
  if (prn.length) {
    add(
      main,
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'prn-h' },
        h('h2', { id: 'prn-h' }, 'Only when needed'),
        h(
          'ul',
          { class: 'plain-list' },
          prn.map((m) => {
            const count = today.asNeededTaken.filter((r) => r.medicationId === m.id).length;
            return h(
              'li',
              { class: 'row' },
              h(
                'div',
                {},
                h(
                  'p',
                  { class: 'name', style: 'font-weight:800;margin:0' },
                  m.name,
                  m.dose ? ` ${m.dose}` : '',
                ),
                h(
                  'p',
                  { class: 'muted', style: 'margin:0' },
                  count ? `Taken ${count} time${count > 1 ? 's' : ''} today` : 'Not taken today',
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'button secondary small',
                  onclick: (e) =>
                    busy(e.currentTarget, async () => {
                      try {
                        await api('/api/doses', {
                          method: 'POST',
                          body: { medicationId: m.id, status: 'taken' },
                        });
                        announce(`Noted: you took ${m.name}.`);
                        ctx.refresh();
                      } catch (err) {
                        announce(err.message, { kind: 'error' });
                      }
                    }),
                },
                'I took one',
              ),
            );
          }),
        ),
      ),
    );
  }

  // ---- Listen and ask ----
  if (doses.length || ctx.ai.gemini) {
    add(
      main,
      h(
        'div',
        { class: 'quick-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'button secondary',
            onclick: (e) => {
              const left = doses.filter(
                (d) => d.status === 'due' || d.status === 'upcoming' || d.status === 'missed',
              );
              const text = left.length
                ? `You have taken ${taken} of ${doses.length} medicines today. Still to take: ${left.map((d) => `${d.name} at ${timeLabel(d.time)}`).join(', ')}.`
                : `You have taken all ${doses.length} medicines today. Well done.`;
              busy(e.currentTarget, () =>
                speak(text, ctx.me.language).catch((err) =>
                  announce(err.message, { kind: 'error' }),
                ),
              );
            },
          },
          icon('speaker'),
          'Read my day aloud',
        ),
        ctx.ai.gemini
          ? h(
              'button',
              { type: 'button', class: 'button secondary', onclick: () => askQuestion(ctx) },
              icon('mic'),
              'Ask a question',
            )
          : null,
      ),
    );
  }
}
