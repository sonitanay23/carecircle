/**
 * Tiny DOM helpers. All user data is inserted as text nodes (never innerHTML),
 * so names, notes and AI answers cannot inject markup.
 */

let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${(idCounter += 1)}`;

/** h('button', { class: 'button', onclick: fn }, 'Save') */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Appends children, skipping null/undefined/false (DOM append would print "null"). */
export const add = (el, ...children) => {
  append(el, children);
  return el;
};

/** Replaces all children, skipping null/undefined/false. */
export const set = (el, ...children) => {
  el.replaceChildren();
  append(el, children);
  return el;
};

/** Removes any visible toasts (used when moving to another screen). */
export const clearToasts = () => document.getElementById('toasts')?.replaceChildren();

export const clear = (el) => {
  el.replaceChildren();
  return el;
};

/** Screen-reader announcement (and a visible toast). */
export function announce(message, { kind = 'info' } = {}) {
  const live = document.getElementById(kind === 'error' ? 'alert-region' : 'status-region');
  if (live) {
    live.textContent = '';
    setTimeout(() => {
      live.textContent = message;
    }, 50);
  }
  const toasts = document.getElementById('toasts');
  if (!toasts) return;
  const t = h('div', { class: `toast toast-${kind}` }, message);
  // Keep at most two on screen so they never pile up over the page.
  while (toasts.children.length >= 2) toasts.firstElementChild.remove();
  toasts.append(t);
  setTimeout(() => t.remove(), 6000);
}

/** A labelled form field with optional hint. Returns the wrapper; the control is `.control`. */
export function field({
  label,
  name,
  type = 'text',
  value,
  hint,
  required,
  options,
  multiline,
  ...rest
}) {
  const id = uid(name);
  const hintId = hint ? `${id}-hint` : undefined;
  let control;
  if (options) {
    control = h(
      'select',
      { id, name, required, 'aria-describedby': hintId, ...rest },
      options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return h(
          'option',
          { value: opt.value, selected: String(opt.value) === String(value ?? '') },
          opt.label,
        );
      }),
    );
  } else if (multiline) {
    control = h(
      'textarea',
      { id, name, required, rows: 3, 'aria-describedby': hintId, ...rest },
      value ?? '',
    );
  } else if (type === 'checkbox') {
    control = h('input', {
      id,
      name,
      type,
      checked: Boolean(value),
      'aria-describedby': hintId,
      ...rest,
    });
    const wrap = h(
      'div',
      { class: 'field field-check' },
      control,
      h('label', { for: id }, label),
      hint && h('p', { class: 'hint', id: hintId }, hint),
    );
    wrap.control = control;
    return wrap;
  } else {
    control = h('input', {
      id,
      name,
      type,
      value: value ?? '',
      required,
      'aria-describedby': hintId,
      ...rest,
    });
  }
  const wrap = h(
    'div',
    { class: 'field' },
    h(
      'label',
      { for: id },
      label,
      required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null,
    ),
    hint && h('p', { class: 'hint', id: hintId }, hint),
    control,
  );
  wrap.control = control;
  return wrap;
}

/** Runs an async action with the button showing it is busy. */
export async function busy(button, fn) {
  if (button.getAttribute('aria-busy') === 'true') return undefined;
  const label = button.textContent;
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  button.textContent = 'Please wait…';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = label;
  }
}

/** Shows an error message inside a form or section (and announces it). */
export function showError(container, err) {
  container.querySelector('.form-error')?.remove();
  const box = h(
    'p',
    { class: 'form-error', role: 'alert' },
    err?.message ?? 'Something went wrong. Please try again.',
  );
  container.prepend(box);
  box.scrollIntoView({ block: 'nearest' });
}

/** Accessible modal dialog using <dialog>. Resolves with the action value. */
export function dialog({ title, body, actions = [{ label: 'Close', value: null }] }) {
  return new Promise((resolve) => {
    const titleId = uid('dlg');
    const dlg = h(
      'dialog',
      { class: 'dialog', 'aria-labelledby': titleId },
      h('h2', { id: titleId }, title),
      h('div', { class: 'dialog-body' }, body),
      h(
        'div',
        { class: 'dialog-actions' },
        actions.map((a) =>
          h(
            'button',
            {
              type: 'button',
              class: `button ${a.kind ?? 'secondary'}`,
              onclick: () => close(a.value),
            },
            a.label,
          ),
        ),
      ),
    );
    const close = (value) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export const confirm = (title, message, { confirmLabel = 'Yes', danger = false } = {}) =>
  dialog({
    title,
    body: h('p', {}, message),
    actions: [
      { label: 'Cancel', value: false },
      { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });

/** "08:00" -> "8:00 am" */
export function timeLabel(hhmm) {
  const [h24, m] = hhmm.split(':').map(Number);
  const suffix = h24 < 12 ? 'am' : 'pm';
  return `${((h24 + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const dateLabel = (iso, opts = {}) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...opts,
  }).format(new Date(iso));

/** Copy text with feedback. */
export async function copy(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    announce(`${what} copied`);
  } catch {
    announce('Could not copy. Please select and copy it yourself.', { kind: 'error' });
  }
}

export const section = (title, ...children) => {
  const id = uid('sec');
  return h(
    'section',
    { class: 'card', 'aria-labelledby': id },
    h('h2', { id }, title),
    ...children,
  );
};

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'ta', label: 'தமிழ் (Tamil)' },
  { value: 'te', label: 'తెలుగు (Telugu)' },
  { value: 'bn', label: 'বাংলা (Bengali)' },
  { value: 'mr', label: 'मराठी (Marathi)' },
  { value: 'gu', label: 'ગુજરાતી (Gujarati)' },
  { value: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { value: 'ml', label: 'മലയാളം (Malayalam)' },
  { value: 'pa', label: 'ਪੰਜਾਬੀ (Punjabi)' },
  { value: 'ur', label: 'اردو (Urdu)' },
];

export function timezoneOptions() {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['Asia/Kolkata', 'UTC'];
  return zones;
}

export const browserTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
