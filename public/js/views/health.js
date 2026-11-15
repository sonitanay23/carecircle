import { api } from '../api.js';
import { h, field, busy, announce, showError, dateLabel, section, add } from '../ui.js';
import { lineChart } from '../chart.js';

const TYPES = [
  { value: 'bp', label: 'Blood pressure' },
  { value: 'sugar', label: 'Blood sugar' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'spo2', label: 'Oxygen level (SpO2)' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'weight', label: 'Weight' },
];
const UNITS = { bp: 'mmHg', sugar: 'mg/dL', pulse: 'beats per minute', spo2: '%', temperature: '°C', weight: 'kg' };

function readingForm(ctx, type) {
  const fields =
    type === 'bp'
      ? [
          field({ label: 'Upper number (systolic)', name: 'systolic', type: 'number', inputmode: 'numeric', required: true, min: 50, max: 260 }),
          field({ label: 'Lower number (diastolic)', name: 'diastolic', type: 'number', inputmode: 'numeric', required: true, min: 30, max: 160 }),
        ]
      : [
          field({ label: `Reading (${UNITS[type]})`, name: 'value', type: 'number', inputmode: 'decimal', step: 'any', required: true }),
          type === 'sugar' &&
            field({ label: 'When was it taken?', name: 'context', options: [{ value: 'fasting', label: 'Fasting (before food)' }, { value: 'after_meal', label: 'After a meal' }, { value: 'random', label: 'Any other time' }] }),
        ];
  const f = h('form', { class: 'stack' }, ...fields, field({ label: 'Note (optional)', name: 'note' }), h('button', { type: 'submit', class: 'button primary huge' }, 'Save reading'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const body = { type, note: v.note || undefined };
    if (type === 'bp') {
      body.systolic = Number(v.systolic);
      body.diastolic = Number(v.diastolic);
    } else {
      body.value = Number(v.value);
      if (type === 'sugar') body.context = v.context;
    }
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        const { reading } = await api('/api/readings', { method: 'POST', body });
        announce(reading.flag ? `Saved ${reading.display}. This is worth mentioning to your doctor.` : `Saved ${reading.display}.`);
        ctx.refresh();
      } catch (err) {
        showError(f, err);
      }
    });
  });
  return f;
}

export async function renderHealth(main, ctx, params) {
  const type = TYPES.some((t) => t.value === params.get('type')) ? params.get('type') : 'bp';
  const { readings, summary } = await api(`/api/readings?type=${type}&days=30`);
  const label = TYPES.find((t) => t.value === type).label;
  const series =
    type === 'bp'
      ? [
          { name: 'Upper (systolic)', points: readings.map((r) => ({ t: r.takenAt, y: r.systolic })) },
          { name: 'Lower (diastolic)', points: readings.map((r) => ({ t: r.takenAt, y: r.diastolic })) },
        ]
      : [{ name: label, points: readings.map((r) => ({ t: r.takenAt, y: r.value })) }];
  const s = summary[0];

  // Big buttons instead of a dropdown: easier to see and tap.
  const picker = h(
    'nav',
    { 'aria-label': 'Type of reading' },
    h('div', { class: 'segmented' }, TYPES.map((t) => h('a', { class: `button ${t.value === type ? 'primary' : 'ghost'} small`, href: `#/health?type=${t.value}`, 'aria-current': t.value === type ? 'page' : undefined }, t.label))),
  );

  add(main, 
    h('h1', { tabindex: '-1' }, 'Health readings'),
    h('p', { class: 'muted' }, 'Readings are for sharing with your doctor. CareCircle does not interpret them.'),
    picker,
    section(
      `${label}, last 30 days`,
      s
        ? h('p', { class: 'big' }, `${s.count} reading${s.count > 1 ? 's' : ''}. Latest: ${s.latest.display}.`, s.flagged ? ` ${s.flagged} worth mentioning to your doctor.` : '')
        : null,
      lineChart({ title: label, unit: UNITS[type], series }),
    ),
    section(`Add a ${label.toLowerCase()} reading`, readingForm(ctx, type)),
    readings.length
      ? section(
          'Recent readings',
          h(
            'ul',
            { class: 'plain-list' },
            readings.slice(0, 20).map((r) =>
              h(
                'li',
                { class: 'row' },
                h('span', {}, h('strong', {}, r.display), ` · ${dateLabel(r.takenAt, { hour: 'numeric', minute: '2-digit' })}`, r.context ? ` · ${r.context.replace('_', ' ')}` : '', ` · ${r.recordedBy.name}`, r.flag ? h('span', { class: 'badge badge-missed' }, ' Mention to doctor') : null),
                (ctx.me.role === 'elder' || r.recordedBy.id === ctx.me.id) &&
                  h('button', {
                    type: 'button',
                    class: 'button ghost',
                    'aria-label': `Delete reading ${r.display}`,
                    onclick: async (e) => {
                      await busy(e.currentTarget, async () => {
                        try {
                          await api(`/api/readings/${r.id}`, { method: 'DELETE' });
                          announce('Reading deleted.');
                          ctx.refresh();
                        } catch (err) {
                          announce(err.message, { kind: 'error' });
                        }
                      });
                    },
                  }, 'Delete'),
              ),
            ),
          ),
        )
      : null,
  );
}
