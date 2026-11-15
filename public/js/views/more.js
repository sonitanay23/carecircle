import { h, add, announce } from '../ui.js';
import { icon } from '../icons.js';
import { TEXT_SIZES, loadPrefs, savePrefs } from '../prefs.js';

const tile = (href, iconName, title, sub) =>
  h(
    'a',
    { class: 'tile', href },
    h('span', { class: 'tile-icon' }, icon(iconName)),
    h('span', { class: 'tile-text' }, title, sub && h('span', { class: 'tile-sub' }, sub)),
    icon('chevron'),
  );

export function renderMore(main, ctx) {
  const prefs = loadPrefs();
  const sizeButtons = TEXT_SIZES.map((s) =>
    h(
      'button',
      {
        type: 'button',
        class: 'button ghost',
        'aria-pressed': String((prefs.size ?? 'normal') === s.value),
        onclick: (e) => {
          savePrefs({ size: s.value });
          e.currentTarget.parentElement
            .querySelectorAll('button')
            .forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          announce(`Text size: ${s.label}`);
        },
      },
      s.label,
    ),
  );
  const contrast = h(
    'button',
    {
      type: 'button',
      class: 'button ghost',
      'aria-pressed': String(Boolean(prefs.contrast)),
      onclick: (e) => {
        const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
        savePrefs({ contrast: on });
        e.currentTarget.setAttribute('aria-pressed', String(on));
        announce(on ? 'High contrast on' : 'High contrast off');
      },
    },
    icon('contrast'),
    'High contrast',
  );

  add(
    main,
    h('h1', { tabindex: '-1' }, 'More'),
    h(
      'nav',
      { class: 'tiles', 'aria-label': 'More options' },
      tile('#/health', 'heart', 'Health readings', 'Blood pressure, sugar, weight'),
      tile('#/medical-id', 'id', 'Medical ID', 'Emergency card and QR code'),
      tile(
        '#/circle',
        'people',
        'Family & settings',
        ctx.me.role === 'elder' ? 'Invite family, approve changes' : 'People, my details',
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'display-h' },
      h('h2', { id: 'display-h' }, 'Easier to read'),
      h('p', { class: 'field-label', id: 'size-label' }, 'Text size'),
      h('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'size-label' }, sizeButtons),
      h('div', { class: 'button-row' }, contrast),
    ),
    h(
      'button',
      { type: 'button', class: 'tile', onclick: () => ctx.signOut() },
      h('span', { class: 'tile-icon' }, icon('signout')),
      h('span', { class: 'tile-text' }, 'Sign out'),
    ),
  );
}
