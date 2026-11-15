import { api, session } from '../api.js';
import {
  h,
  add,
  field,
  busy,
  showError,
  LANGUAGES,
  timezoneOptions,
  browserTimezone,
} from '../ui.js';
import { icon } from '../icons.js';

const rememberField = () =>
  field({
    label: 'Keep me signed in on this phone',
    name: 'remember',
    type: 'checkbox',
    value: true,
    hint: 'Untick this on a shared computer.',
  });

/** Optional extras, folded away so the form stays short. */
const extras = (...children) =>
  h(
    'details',
    {},
    h('summary', {}, 'More options (optional)'),
    h('div', { class: 'stack' }, ...children),
  );
const tzField = () =>
  field({
    label: 'Time zone',
    name: 'timezone',
    value: browserTimezone(),
    options: timezoneOptions(),
    hint: 'We picked this from your phone.',
  });
const langField = () =>
  field({ label: 'Language for reminders', name: 'language', value: 'en', options: LANGUAGES });
const phoneField = () =>
  field({
    label: 'Phone number',
    name: 'phone',
    type: 'tel',
    autocomplete: 'tel',
    hint: 'With country code, e.g. +91 98765 43210',
  });

function form(onSubmit, ...children) {
  const f = h('form', { class: 'stack' }, ...children);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        const values = Object.fromEntries(new FormData(f));
        values.timezone ??= browserTimezone();
        values.language ??= 'en';
        await onSubmit(values);
      } catch (err) {
        showError(f, err);
      }
    });
  });
  return f;
}

const signedIn = (ctx, data, remember) => {
  session.save(data, { remember: remember === 'on' });
  ctx.go('#/today');
};

const tile = (href, iconName, title, sub, primary) =>
  h(
    'a',
    { class: `tile${primary ? ' primary' : ''}`, href },
    h('span', { class: 'tile-icon' }, icon(iconName)),
    h('span', { class: 'tile-text' }, title, h('span', { class: 'tile-sub' }, sub)),
    icon('chevron'),
  );

export function renderSignIn(main, ctx) {
  add(
    main,
    h('h1', { tabindex: '-1' }, 'Welcome to CareCircle'),
    h(
      'p',
      { class: 'lead' },
      'Your medicines and doctor visits in one place, shared with family. You stay in charge.',
    ),
    h(
      'div',
      { class: 'tiles' },
      tile('#/create', 'heart', "I'm new here", 'Start my CareCircle', true),
      tile('#/join', 'people', 'I have an invite', 'From a family member'),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'signin-h' },
      h('h2', { id: 'signin-h' }, 'Already using CareCircle? Sign in'),
      form(
        async (v) =>
          signedIn(
            ctx,
            await api('/api/sessions', {
              method: 'POST',
              body: { profileCode: v.profileCode, passcode: v.passcode },
            }),
            v.remember,
          ),
        field({
          label: 'CareCircle code',
          name: 'profileCode',
          required: true,
          autocomplete: 'username',
          autocapitalize: 'characters',
          hint: 'It looks like ABCD-EFGH.',
        }),
        field({
          label: 'Your passcode',
          name: 'passcode',
          type: 'password',
          required: true,
          autocomplete: 'current-password',
        }),
        rememberField(),
        h('button', { type: 'submit', class: 'button primary huge' }, 'Sign in'),
      ),
    ),
  );
}

export function renderCreate(main, ctx) {
  add(
    main,
    h('h1', { tabindex: '-1' }, 'Start your CareCircle'),
    h(
      'p',
      { class: 'lead' },
      'This is for the person whose medicines these are. You can invite family afterwards. You decide what changes.',
    ),
    h(
      'section',
      { class: 'card' },
      form(
        async (v) => {
          const data = await api('/api/profiles', {
            method: 'POST',
            body: {
              elderName: v.elderName,
              email: v.email,
              phone: v.phone || undefined,
              timezone: v.timezone,
              language: v.language,
              passcode: v.passcode,
            },
          });
          signedIn(ctx, data, v.remember);
        },
        field({ label: 'Your name', name: 'elderName', required: true, autocomplete: 'name' }),
        field({
          label: 'Your email',
          name: 'email',
          type: 'email',
          required: true,
          autocomplete: 'email',
          hint: 'Reminders are sent here.',
        }),
        field({
          label: 'Choose a passcode',
          name: 'passcode',
          type: 'password',
          required: true,
          minlength: 6,
          autocomplete: 'new-password',
          hint: 'At least 6 letters or numbers. Not 123456.',
        }),
        extras(phoneField(), langField(), tzField()),
        rememberField(),
        h('button', { type: 'submit', class: 'button primary huge' }, 'Create my CareCircle'),
      ),
    ),
    h('p', {}, h('a', { href: '#/welcome' }, '← Back')),
  );
}

export function renderJoin(main, ctx, params) {
  add(
    main,
    h('h1', { tabindex: '-1' }, 'Join a CareCircle'),
    h('p', { class: 'lead' }, 'Use the two codes you were sent. Then choose your own passcode.'),
    h(
      'section',
      { class: 'card' },
      form(
        async (v) => {
          const data = await api('/api/members/join', {
            method: 'POST',
            body: {
              profileCode: v.profileCode,
              inviteCode: v.inviteCode,
              passcode: v.passcode,
              email: v.email,
              phone: v.phone || undefined,
              timezone: v.timezone,
              language: v.language,
            },
          });
          signedIn(ctx, data, v.remember);
        },
        field({
          label: 'CareCircle code',
          name: 'profileCode',
          value: params.get('profile') ?? '',
          required: true,
          autocapitalize: 'characters',
          hint: 'It looks like ABCD-EFGH.',
        }),
        field({
          label: 'Invite code',
          name: 'inviteCode',
          required: true,
          autocapitalize: 'characters',
          hint: 'It looks like ABCDE-FGHJK.',
        }),
        field({
          label: 'Your email',
          name: 'email',
          type: 'email',
          required: true,
          autocomplete: 'email',
        }),
        field({
          label: 'Choose a passcode',
          name: 'passcode',
          type: 'password',
          required: true,
          minlength: 6,
          autocomplete: 'new-password',
        }),
        extras(phoneField(), langField(), tzField()),
        rememberField(),
        h('button', { type: 'submit', class: 'button primary huge' }, 'Join'),
      ),
    ),
    h('p', {}, h('a', { href: '#/welcome' }, '← Back')),
  );
}
