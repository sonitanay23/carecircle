import { api } from '../api.js';
import { h, add, set, field, busy, announce, showError, dialog, confirm, timeLabel } from '../ui.js';
import { icon } from '../icons.js';
import { speak } from '../voice.js';

const longDate = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`));

function daysAway(iso) {
  const today = new Date(new Date().toLocaleDateString('en-CA'));
  const days = Math.round((new Date(iso) - today) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return `In ${days} days`;
  return null;
}

function visitForm(ctx, onDone) {
  const f = h(
    'form',
    { class: 'stack', novalidate: true },
    field({ label: 'What is the visit for?', name: 'title', required: true, hint: 'For example: Eye check-up, Diabetes review' }),
    field({ label: 'Date', name: 'date', type: 'date', required: true, min: new Date().toLocaleDateString('en-CA') }),
    field({ label: 'Time', name: 'time', type: 'time', required: true, value: '10:00' }),
    field({ label: 'Doctor (optional)', name: 'doctor', hint: 'For example: Dr Rao' }),
    field({ label: 'Hospital or clinic (optional)', name: 'placeName' }),
    field({ label: 'Address (optional)', name: 'address', hint: 'Used to give directions in Google Maps' }),
    h('details', {}, h('summary', {}, 'More details (optional)'), h('div', { class: 'stack' },
      field({ label: 'Speciality', name: 'specialty' }),
      field({ label: 'How long (minutes)', name: 'durationMinutes', type: 'number', value: 30, min: 5, max: 480 }),
      field({ label: 'Notes', name: 'notes', multiline: true, hint: 'For example: bring last blood test report' }),
    )),
    h('button', { type: 'submit', class: 'button primary huge' }, icon('check', { size: 26 }), 'Save visit'),
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    if (!v.title?.trim() || !v.date || !v.time) {
      showError(f, new Error('Please fill in what the visit is for, the date and the time.'));
      return;
    }
    const body = {
      title: v.title.trim(),
      doctor: v.doctor || undefined,
      specialty: v.specialty || undefined,
      date: v.date,
      time: v.time,
      durationMinutes: Number(v.durationMinutes) || 30,
      location: v.placeName || v.address ? { name: v.placeName || undefined, address: v.address || undefined } : undefined,
      notes: v.notes || undefined,
    };
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        const r = await api('/api/appointments', { method: 'POST', body });
        announce(r.status === 'pending' ? 'Sent for approval.' : 'Visit saved.');
        onDone();
        ctx.refresh();
      } catch (err) {
        showError(f, err);
      }
    });
  });
  return f;
}

async function prepare(ctx, a) {
  const lang = ctx.me.language ?? 'en';
  const body = h('div', { class: 'stack' }, h('p', { class: 'scan-status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Preparing your notes…'));
  const opened = dialog({ title: `For your visit: ${a.title}`, body });
  try {
    const s = await api(`/api/appointments/${a.id}/visit-summary?lang=${lang}`);
    set(
      body,
      h('p', { class: 'big' }, s.overview),
      s.questionsForDoctor.length > 0 && h('div', {}, h('h3', {}, 'Questions to ask the doctor'), h('ol', {}, s.questionsForDoctor.map((q) => h('li', {}, q)))),
      s.medicines && h('div', {}, h('h3', {}, 'Medicines'), h('p', {}, s.medicines)),
      s.readings && h('div', {}, h('h3', {}, 'Readings'), h('p', {}, s.readings)),
      h(
        'div',
        { class: 'button-row stretch no-print' },
        h('button', { type: 'button', class: 'button secondary', onclick: (e) => busy(e.currentTarget, () => speak([s.overview, ...s.questionsForDoctor].join('. '), lang).catch(() => {})) }, icon('speaker'), 'Read aloud'),
        h('button', { type: 'button', class: 'button secondary', onclick: () => window.print() }, icon('print'), 'Print'),
      ),
      h('p', { class: 'disclaimer' }, s.disclaimer),
    );
  } catch (err) {
    set(body, h('p', { role: 'alert', class: 'big' }, err.message));
  }
  await opened;
}

function visitCard(ctx, a, past) {
  const place = [a.location?.name, a.location?.address].filter(Boolean).join(', ');
  const soon = !past && daysAway(a.date);
  const link = (href, iconName, text) =>
    href && h('a', { class: 'button secondary', href, target: '_blank', rel: 'noopener noreferrer' }, icon(iconName, { size: 20 }), text, h('span', { class: 'visually-hidden' }, ' (opens in a new tab)'));
  return h(
    'li',
    { class: 'card' },
    soon ? h('span', { class: 'pill pill-due' }, soon) : null,
    h('h3', { style: 'font-size:1.3rem;margin-top:0.4rem' }, a.title),
    h('p', { class: 'big', style: 'font-weight:700' }, `${longDate(a.date)} · ${timeLabel(a.time)}`),
    a.doctor && h('p', {}, `With ${a.doctor}${a.specialty ? ` (${a.specialty})` : ''}`),
    place && h('p', { class: 'muted' }, icon('map', { size: 18 }), ' ', place),
    a.status !== 'scheduled' && h('span', { class: `pill ${a.status === 'completed' ? 'pill-done' : 'pill-skipped'}` }, a.status === 'completed' ? '✓ Went' : 'Cancelled'),
    a.visitNotes && h('p', { class: 'muted' }, a.visitNotes),
    !past && h('div', { class: 'button-row stretch' }, link(a.links.directions, 'map', 'Directions'), link(a.links.googleCalendar, 'calendar', 'Add to Google Calendar')),
    !past && ctx.ai.gemini && h('button', { type: 'button', class: 'button primary block', onclick: () => prepare(ctx, a) }, icon('sparkle'), 'Prepare for this visit'),
    !past &&
      h(
        'details',
        {},
        h('summary', {}, 'More options'),
        h(
          'div',
          { class: 'button-row' },
          link(a.links.nearbyPharmacies, 'map', 'Pharmacies nearby'),
          h('button', {
            type: 'button',
            class: 'button ghost',
            onclick: (e) =>
              busy(e.currentTarget, async () => {
                try {
                  await api(`/api/appointments/${a.id}/attended`, { method: 'POST', body: {} });
                  announce('Marked as visited.');
                  ctx.refresh();
                } catch (err) {
                  announce(err.message, { kind: 'error' });
                }
              }),
          }, 'I went to this visit'),
          h('button', {
            type: 'button',
            class: 'button danger-text',
            onclick: async () => {
              if (!(await confirm('Cancel this visit?', `${a.title} on ${longDate(a.date)}.`, { confirmLabel: 'Yes, cancel it', danger: true }))) return;
              try {
                const r = await api(`/api/appointments/${a.id}`, { method: 'DELETE' });
                announce(r.status === 'pending' ? 'Cancellation sent for approval.' : 'Visit cancelled.');
                ctx.refresh();
              } catch (err) {
                announce(err.message, { kind: 'error' });
              }
            },
          }, 'Cancel visit'),
        ),
      ),
  );
}

export async function renderAppointments(main, ctx, params) {
  const past = params.get('show') === 'past';
  const { appointments } = await api(`/api/appointments?when=${past ? 'past' : 'upcoming'}`);
  const formArea = h('div');
  add(
    main,
    h('h1', { tabindex: '-1' }, past ? 'Past visits' : 'Doctor visits'),
    !past &&
      h('button', {
        type: 'button',
        class: 'tile primary',
        onclick: () => {
          set(formArea, h('section', { class: 'card', 'aria-labelledby': 'visit-h' }, h('h2', { id: 'visit-h', tabindex: '-1' }, 'Add a visit'), visitForm(ctx, () => set(formArea))));
          formArea.querySelector('#visit-h').focus();
        },
      }, h('span', { class: 'tile-icon' }, icon('plus')), h('span', { class: 'tile-text' }, 'Add a doctor visit', h('span', { class: 'tile-sub' }, 'We will remind you the day before'))),
    formArea,
    appointments.length
      ? h('ul', { class: 'plain-list' }, appointments.map((a) => visitCard(ctx, a, past)))
      : h('p', { class: 'muted big' }, past ? 'No past visits yet.' : 'No visits coming up.'),
    h('p', {}, h('a', { href: past ? '#/appointments' : '#/appointments?show=past' }, past ? '← Back to upcoming visits' : 'See past visits')),
  );
}
