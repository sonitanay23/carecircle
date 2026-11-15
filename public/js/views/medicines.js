import { api } from '../api.js';
import { h, add, set, field, busy, announce, showError, dialog, confirm, timeLabel, uid } from '../ui.js';
import { icon, partOfDay } from '../icons.js';
import { speak } from '../voice.js';
import { prepareImage } from '../image.js';

const FORMS = ['tablet', 'capsule', 'liquid', 'injection', 'inhaler', 'drops', 'cream', 'other'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SLOTS = [
  { time: '08:00', label: 'Morning', sub: '8 am' },
  { time: '14:00', label: 'Afternoon', sub: '2 pm' },
  { time: '20:00', label: 'Evening', sub: '8 pm' },
  { time: '22:00', label: 'Bedtime', sub: '10 pm' },
];
const FOOD = [
  { value: 'Before food', label: 'Before food' },
  { value: 'After food', label: 'After food' },
  { value: 'With food', label: 'With food' },
  { value: '', label: 'Any time' },
];
const DURATIONS = [
  { value: '', label: 'No end date' },
  { value: '3', label: '3 days' },
  { value: '5', label: '5 days' },
  { value: '7', label: '1 week' },
  { value: '10', label: '10 days' },
  { value: '14', label: '2 weeks' },
  { value: '30', label: '1 month' },
  { value: '90', label: '3 months' },
];

const todayIso = () => new Date().toLocaleDateString('en-CA');
const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T12:00:00`) + n * 86_400_000).toLocaleDateString('en-CA');
const label = (m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}`;
const outcome = (r, what) => (r.status === 'pending' ? `${what} was sent for approval. Nothing changes until it is approved.` : `${what} saved.`);

/** A big tap-to-choose option (checkbox or radio styled as a button). */
const choice = ({ type = 'checkbox', name, value, checked, title, sub }) =>
  h('label', { class: 'choice' }, h('input', { type, name, value, checked: Boolean(checked) }), h('span', {}, h('span', {}, title, sub && h('small', {}, sub))));

/**
 * Add / change form. `draft` pre-fills it (e.g. from a scanned prescription).
 * Times are chosen with big "Morning / Afternoon / Evening / Bedtime" buttons.
 */
function medicineForm(ctx, { draft = {}, id, onDone } = {}) {
  const times = draft.schedule?.times ?? (id ? [] : ['08:00']);
  const otherTimes = times.filter((t) => !SLOTS.some((s) => s.time === t));
  const food = FOOD.find((f) => f.value && (draft.instructions ?? '').toLowerCase().startsWith(f.value.toLowerCase()));
  const extraNote = food ? (draft.instructions ?? '').slice(food.value.length).replace(/^[\s,.;-]+/, '') : draft.instructions ?? '';

  const customBox = h('div', {});
  const addCustom = (value = '') => {
    const inputId = uid('time');
    const row = h(
      'div',
      { class: 'time-row' },
      h('label', { class: 'visually-hidden', for: inputId }, 'Time'),
      h('input', { type: 'time', name: 'customTime', value, id: inputId }),
      h('button', { type: 'button', class: 'button ghost small', onclick: () => row.remove() }, 'Remove'),
    );
    customBox.append(row);
  };
  otherTimes.forEach(addCustom);

  const days = draft.schedule?.days ?? [];
  const endDate = draft.schedule?.endDate;
  const durationOptions = [...DURATIONS];
  if (endDate) durationOptions.push({ value: `until:${endDate}`, label: `Until ${new Date(`${endDate}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` });

  const f = h(
    'form',
    { class: 'stack', novalidate: true },
    field({ label: 'Medicine name', name: 'name', value: draft.name, required: true, autocomplete: 'off', hint: 'As written on the strip or box' }),
    field({ label: 'Strength (optional)', name: 'dose', value: draft.dose, hint: 'For example 500 mg' }),
    h(
      'fieldset',
      { class: 'fieldset' },
      h('legend', {}, 'When do you take it?'),
      h('p', { class: 'hint' }, 'Tap all that apply.'),
      h(
        'div',
        { class: 'choices' },
        SLOTS.map((s) => choice({ name: 'slot', value: s.time, checked: !draft.asNeeded && times.includes(s.time), title: s.label, sub: s.sub })),
        choice({ name: 'asNeeded', value: 'on', checked: draft.asNeeded, title: 'Only when needed', sub: 'No fixed time' }),
      ),
      h('details', { open: otherTimes.length > 0 }, h('summary', {}, 'A different time'), customBox, h('button', { type: 'button', class: 'button ghost small', onclick: () => addCustom('') }, icon('plus', { size: 18 }), 'Add a time')),
    ),
    h(
      'fieldset',
      { class: 'fieldset' },
      h('legend', {}, 'With food?'),
      h('div', { class: 'choices' }, FOOD.map((o) => choice({ type: 'radio', name: 'food', value: o.value, checked: food ? food.value === o.value : o.value === '', title: o.label }))),
    ),
    field({ label: 'For how long?', name: 'duration', value: endDate ? `until:${endDate}` : '', options: durationOptions }),
    h(
      'details',
      { open: days.length > 0 },
      h('summary', {}, 'Only on some days of the week'),
      h('div', { class: 'choices' }, DAYS.map((d, i) => choice({ name: 'days', value: String(i), checked: days.includes(i), title: d }))),
      h('p', { class: 'hint' }, 'Leave all unticked for every day.'),
    ),
    h(
      'details',
      {},
      h('summary', {}, 'More details (optional)'),
      h(
        'div',
        { class: 'stack' },
        field({ label: 'Other instructions', name: 'note', value: extraNote, hint: 'For example: half a tablet' }),
        field({ label: 'Type', name: 'form', value: draft.form ?? 'tablet', options: FORMS }),
        field({ label: 'What it is for', name: 'purpose', value: draft.purpose, hint: 'For example: blood pressure' }),
        field({ label: 'Start date', name: 'startDate', type: 'date', value: draft.schedule?.startDate ?? todayIso() }),
        id ? null : field({ label: 'How many tablets do you have now?', name: 'stock', type: 'number', min: 0, max: 10000, inputmode: 'numeric', hint: 'We will remind you before they run out.' }),
      ),
    ),
    h('button', { type: 'submit', class: 'button primary huge' }, icon('check', { size: 26 }), id ? 'Save changes' : 'Save medicine'),
  );

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const name = String(fd.get('name') ?? '').trim();
    if (!name) {
      showError(f, new Error('Please write the medicine name.'));
      f.querySelector('[name=name]').focus();
      return;
    }
    const asNeeded = fd.get('asNeeded') === 'on';
    const chosen = [...new Set([...fd.getAll('slot'), ...fd.getAll('customTime').filter(Boolean)])].sort();
    if (!asNeeded && !chosen.length) {
      showError(f, new Error('Please choose when you take it, or tick "Only when needed".'));
      return;
    }
    const instructions = [fd.get('food'), String(fd.get('note') ?? '').trim()].filter(Boolean).join('. ');
    const startDate = fd.get('startDate') || todayIso();
    const duration = String(fd.get('duration') ?? '');
    const end = duration.startsWith('until:') ? duration.slice(6) : duration ? addDaysIso(startDate, Number(duration) - 1) : undefined;
    const body = {
      name,
      dose: String(fd.get('dose') ?? '').trim() || undefined,
      form: fd.get('form') ?? 'tablet',
      instructions: instructions || undefined,
      purpose: String(fd.get('purpose') ?? '').trim() || undefined,
      asNeeded,
    };
    if (!asNeeded) body.schedule = { times: chosen, days: fd.getAll('days').map(Number), startDate, endDate: end };
    if (!id && fd.get('stock')) body.stock = { count: Number(fd.get('stock')) };
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        const r = await api(id ? `/api/medications/${id}` : '/api/medications', { method: id ? 'PATCH' : 'POST', body });
        announce(outcome(r, name));
        onDone?.();
        ctx.refresh();
      } catch (err) {
        showError(f, err);
      }
    });
  });
  return f;
}

async function explain(ctx, med) {
  const lang = ctx.me.language ?? 'en';
  const body = h('div', { class: 'stack' }, h('p', { class: 'scan-status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Finding out…'));
  const opened = dialog({ title: `About ${med.name}`, body });
  try {
    const r = await api(`/api/medications/${med.id}/explanation?lang=${lang}`);
    const spoken = [r.summary, r.howToTake, ...r.commonSideEffects, ...r.askDoctorIf].join('. ');
    set(
      body,
      h('p', { class: 'big' }, r.summary),
      r.howToTake && h('p', {}, h('strong', {}, 'How to take it: '), r.howToTake),
      r.commonSideEffects.length > 0 && h('div', {}, h('h3', {}, 'Common side effects'), h('ul', {}, r.commonSideEffects.map((x) => h('li', {}, x)))),
      r.askDoctorIf.length > 0 && h('div', {}, h('h3', {}, 'Call your doctor if'), h('ul', {}, r.askDoctorIf.map((x) => h('li', {}, x)))),
      h('button', { type: 'button', class: 'button secondary block', onclick: (e) => busy(e.currentTarget, () => speak(spoken, lang).catch(() => {})) }, icon('speaker'), 'Read aloud'),
      h('p', { class: 'disclaimer' }, r.disclaimer),
    );
  } catch (err) {
    set(body, h('p', { role: 'alert', class: 'big' }, err.message));
  }
  await opened;
}

async function checkClashes(ctx) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'scan-status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Checking your medicines…'));
  const opened = dialog({ title: 'Do my medicines clash?', body });
  try {
    const r = await api(`/api/ai/interactions?lang=${ctx.me.language ?? 'en'}`);
    set(
      body,
      h('p', { class: 'big' }, r.summary),
      r.concerns.length
        ? h('ul', { class: 'plain-list' }, r.concerns.map((c) => h('li', { class: `concern ${c.urgency}` }, h('strong', {}, c.medicines.join(' + ')), h('p', {}, c.explanation), h('p', {}, h('em', {}, c.urgency === 'ask_soon' ? 'Ask your doctor or pharmacist soon.' : 'Mention it at your next visit.')))))
        : h('div', { class: 'banner done' }, icon('check'), h('p', {}, 'No well-known clashes were found.')),
      h('p', { class: 'disclaimer' }, r.disclaimer),
    );
  } catch (err) {
    set(body, h('p', { role: 'alert', class: 'big' }, err.message));
  }
  await opened;
}

/** Reads a prescription photo and shows draft medicines to check one by one. */
async function scan(ctx, file, area, openManual) {
  set(area, h('div', { class: 'card' }, h('p', { class: 'scan-status', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Reading your prescription… this takes about 10 seconds.')));
  area.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const tips = h(
    'ul',
    {},
    h('li', {}, 'Put the paper flat on a table, in good light.'),
    h('li', {}, 'Fit the whole prescription in the photo.'),
    h('li', {}, 'Hold the phone steady, straight above the paper.'),
  );
  const retry = () =>
    h(
      'div',
      { class: 'button-row stretch' },
      h('label', { class: 'button primary', for: 'scan-input' }, icon('camera'), 'Try another photo'),
      h('button', { type: 'button', class: 'button secondary', onclick: openManual }, 'Add by hand'),
    );
  try {
    const jpeg = await prepareImage(file);
    const r = await api('/api/ai/prescription-scan', { method: 'POST', raw: jpeg, type: 'image/jpeg' });
    if (!r.readable) {
      set(area, h('div', { class: 'card stack', role: 'alert' }, h('h2', {}, 'We could not read this photo'), h('p', {}, 'That is OK. These tips usually help:'), tips, retry()));
      return;
    }
    const list = h('ul', { class: 'plain-list' });
    for (const d of r.drafts) {
      const holder = h('div');
      const item = h(
        'li',
        { class: `card draft${d.needsCheck ? ' needs-check' : ''}` },
        h(
          'div',
          { class: 'med-head' },
          h('span', { class: 'pill-icon' }, icon('pill')),
          h(
            'div',
            {},
            h('h3', {}, label(d)),
            h('div', { class: 'chips' }, d.asNeeded ? h('span', { class: 'chip' }, 'Only when needed') : d.schedule.times.map((t) => h('span', { class: 'chip' }, icon(partOfDay(t).icon, { size: 18 }), timeLabel(t)))),
            d.instructions && h('p', { class: 'muted' }, d.instructions),
            d.needsCheck && h('span', { class: 'pill pill-check' }, icon('warning', { size: 16 }), 'Please check this one carefully'),
          ),
        ),
        h(
          'div',
          { class: 'button-row stretch' },
          h('button', {
            type: 'button',
            class: 'button primary',
            onclick: (e) => {
              e.currentTarget.parentElement.remove();
              set(holder, h('p', { class: 'muted' }, 'Check the details, change anything that is wrong, then save.'), medicineForm(ctx, { draft: d, onDone: () => set(item, h('div', { class: 'banner done' }, icon('check'), h('p', {}, `${label(d)} added.`))) }));
            },
          }, 'Check and add'),
          h('button', { type: 'button', class: 'button ghost', onclick: () => item.remove() }, 'Not this one'),
        ),
        holder,
      );
      list.append(item);
    }
    set(
      area,
      h('h2', { tabindex: '-1', id: 'scan-results' }, `We found ${r.drafts.length} medicine${r.drafts.length > 1 ? 's' : ''}`),
      h('div', { class: 'banner warn' }, icon('warning'), h('p', {}, h('strong', {}, 'Please check each one against the paper prescription. '), 'Computers can misread handwriting.')),
      r.warnings.length > 0 && h('ul', { class: 'muted' }, r.warnings.map((w) => h('li', {}, w))),
      list,
      h('p', { class: 'disclaimer' }, r.disclaimer),
    );
    area.querySelector('#scan-results').focus();
  } catch (err) {
    set(area, h('div', { class: 'card stack', role: 'alert' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'big' }, err.message), tips, retry()));
  }
}

function medicineCard(ctx, m) {
  const visual = m.hasPhoto ? h('img', { class: 'pill-photo', alt: `Photo of ${m.name}`, width: 72, height: 72 }) : h('span', { class: 'pill-icon' }, icon('pill'));
  if (m.hasPhoto) api(`/api/medications/${m.id}/photo`, { as: 'blob' }).then((b) => { visual.src = URL.createObjectURL(b); }).catch(() => {});
  const editArea = h('div');
  const photoInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', id: `photo-${m.id}` });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    try {
      const jpeg = await prepareImage(file, { maxSide: 800, quality: 0.8 });
      await api(`/api/medications/${m.id}/photo`, { method: 'PUT', raw: jpeg, type: 'image/jpeg' });
      announce('Photo saved.');
      ctx.refresh();
    } catch (err) {
      announce(err.message, { kind: 'error' });
    }
  });
  const supply = m.supply;
  return h(
    'li',
    { class: 'card med-card' },
    h(
      'div',
      { class: 'med-head' },
      visual,
      h(
        'div',
        {},
        h('h3', {}, label(m)),
        h(
          'div',
          { class: 'chips' },
          m.asNeeded
            ? h('span', { class: 'chip' }, 'Only when needed')
            : m.schedule.times.map((t) => h('span', { class: 'chip' }, icon(partOfDay(t).icon, { size: 18 }), timeLabel(t))),
        ),
        m.schedule?.days?.length ? h('p', { class: 'muted small' }, `Only on ${m.schedule.days.map((d) => DAYS[d]).join(', ')}`) : null,
        m.instructions && h('p', { class: 'muted' }, m.instructions),
        supply && h('p', { class: supply.low ? 'supply-low' : 'muted' }, supply.low ? '⚠ Running low · ' : '', `${supply.count} left`, supply.daysLeft !== null ? ` · about ${supply.daysLeft} days` : ''),
      ),
    ),
    h(
      'div',
      { class: 'button-row stretch' },
      ctx.ai.gemini && h('button', { type: 'button', class: 'button secondary', onclick: () => explain(ctx, m) }, 'What is it for?'),
      h('button', {
        type: 'button',
        class: 'button secondary',
        onclick: async () => {
          const input = field({ label: 'How many did you buy?', name: 'added', type: 'number', min: 1, max: 1000, inputmode: 'numeric', required: true });
          const ok = await dialog({ title: `New stock of ${m.name}`, body: input, actions: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, kind: 'primary' }] });
          const added = Number(input.control.value);
          if (!ok || !added) return;
          try {
            await api(`/api/medications/${m.id}/refill`, { method: 'POST', body: { added } });
            announce(`Added ${added} to ${m.name}.`);
            ctx.refresh();
          } catch (err) {
            announce(err.message, { kind: 'error' });
          }
        },
      }, 'I bought more'),
    ),
    h(
      'details',
      {},
      h('summary', {}, 'More options'),
      h(
        'div',
        { class: 'button-row' },
        h('label', { class: 'button ghost', for: `photo-${m.id}` }, icon('camera', { size: 20 }), m.hasPhoto ? 'Change photo' : 'Add a photo of the tablet'),
        photoInput,
        h('button', { type: 'button', class: 'button ghost', onclick: () => set(editArea, h('h3', {}, `Change ${m.name}`), medicineForm(ctx, { draft: m, id: m.id, onDone: () => set(editArea) })) }, 'Change times or details'),
        h('button', {
          type: 'button',
          class: 'button danger-text',
          onclick: async () => {
            if (!(await confirm(`Stop ${m.name}?`, 'It will no longer be on your list. The history is kept.', { confirmLabel: 'Yes, stop it', danger: true }))) return;
            try {
              announce(outcome(await api(`/api/medications/${m.id}`, { method: 'DELETE' }), `Stopping ${m.name}`));
              ctx.refresh();
            } catch (err) {
              announce(err.message, { kind: 'error' });
            }
          },
        }, 'Stop this medicine'),
      ),
      editArea,
    ),
  );
}

function medicineList(ctx, medications) {
  return medications.length
    ? h('section', { 'aria-labelledby': 'list-h' }, h('h2', { id: 'list-h' }, `Your medicines (${medications.length})`), h('ul', { class: 'plain-list' }, medications.map((m) => medicineCard(ctx, m))))
    : h('p', { class: 'muted big' }, 'No medicines yet.');
}

export async function renderMedicines(main, ctx) {
  const { medications } = await api('/api/medications');
  const workArea = h('div', { 'aria-live': 'polite' });
  const listArea = h('div');
  // Adding a scanned medicine refreshes only the list, so the other drafts stay on screen.
  const scanCtx = {
    ...ctx,
    refresh: async () => {
      const fresh = await api('/api/medications').catch(() => null);
      if (fresh) set(listArea, medicineList(ctx, fresh.medications));
    },
  };
  const openManual = () => {
    set(workArea, h('section', { class: 'card', 'aria-labelledby': 'add-h' }, h('h2', { id: 'add-h', tabindex: '-1' }, 'Add a medicine'), medicineForm(ctx, { onDone: () => set(workArea) })));
    workArea.querySelector('#add-h').focus();
  };
  const scanInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', id: 'scan-input' });
  scanInput.addEventListener('change', () => {
    const file = scanInput.files[0];
    scanInput.value = '';
    if (file) scan(scanCtx, file, workArea, openManual);
  });
  const first = ctx.profile.elderName.split(' ')[0];

  add(
    main,
    h('h1', { tabindex: '-1' }, 'Medicines'),
    ctx.me.role !== 'elder' ? h('div', { class: 'banner info' }, icon('info'), h('p', {}, `Changes you make are sent to ${first} to approve.`)) : null,
    h(
      'div',
      { class: `tiles${ctx.ai.gemini ? ' two' : ''}` },
      ctx.ai.gemini &&
        h('label', { class: 'tile primary', for: 'scan-input' }, h('span', { class: 'tile-icon' }, icon('camera')), h('span', { class: 'tile-text' }, 'Scan a prescription', h('span', { class: 'tile-sub' }, 'Take a photo'))),
      ctx.ai.gemini && scanInput,
      h('button', { type: 'button', class: 'tile', onclick: openManual }, h('span', { class: 'tile-icon' }, icon('plus')), h('span', { class: 'tile-text' }, 'Add by hand', h('span', { class: 'tile-sub' }, 'Type it in'))),
    ),
    workArea,
    add(listArea, medicineList(ctx, medications)),
    ctx.ai.gemini && medications.length > 1 ? h('button', { type: 'button', class: 'button ghost block', onclick: () => checkClashes(ctx) }, 'Do my medicines clash? Check with AI') : null,
  );
}
