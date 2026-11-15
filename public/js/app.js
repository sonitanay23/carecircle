/**
 * CareCircle front end: a small hash-router app with no build step and no
 * third-party scripts (works with a strict Content-Security-Policy).
 */
import { api, session } from './api.js';
import { h, clear, announce, dialog, field, clearToasts } from './ui.js';
import { icon } from './icons.js';
import { loadPrefs, applyPrefs } from './prefs.js';
import { renderSignIn, renderCreate, renderJoin } from './views/welcome.js';
import { renderToday } from './views/today.js';
import { renderMedicines } from './views/medicines.js';
import { renderAppointments } from './views/appointments.js';
import { renderHealth } from './views/health.js';
import { renderCircle } from './views/circle.js';
import { renderMedicalId } from './views/medicalId.js';
import { renderMore } from './views/more.js';
import { stopSpeaking } from './voice.js';

const PUBLIC = {
  welcome: { title: 'Sign in', render: renderSignIn },
  create: { title: 'Start a CareCircle', render: renderCreate },
  join: { title: 'Join', render: renderJoin },
};
// `tab` is the bottom-navigation tab that is highlighted for each screen.
const PRIVATE = {
  today: { title: 'Today', render: renderToday, tab: 'today' },
  medicines: { title: 'Medicines', render: renderMedicines, tab: 'medicines' },
  appointments: { title: 'Doctor visits', render: renderAppointments, tab: 'appointments' },
  more: { title: 'More', render: renderMore, tab: 'more' },
  health: { title: 'Health readings', render: renderHealth, tab: 'more' },
  'medical-id': { title: 'Medical ID', render: renderMedicalId, tab: 'more' },
  circle: { title: 'Family & settings', render: renderCircle, tab: 'more' },
};
const TABS = [
  { name: 'today', label: 'Today', icon: 'home' },
  { name: 'medicines', label: 'Medicines', icon: 'pill' },
  { name: 'appointments', label: 'Visits', icon: 'calendar' },
  { name: 'more', label: 'More', icon: 'menu' },
];

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const headerTools = document.getElementById('header-tools');
let aiStatus = { gemini: false, translation: false, readAloud: false };
let aiStatusFor = null; // token the status was loaded for

const parseHash = () => {
  const [path, query = ''] = (location.hash.replace(/^#\/?/, '') || 'today').split('?');
  return { name: path, params: new URLSearchParams(query) };
};

const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

function signOut() {
  session.clear();
  navigator.serviceWorker?.controller?.postMessage({ type: 'clear-data' });
  announce('Signed out.');
  go('#/welcome');
}

// ---------- Help (SOS) ----------
async function help() {
  const share = field({ label: 'Share where I am', name: 'share', type: 'checkbox', value: true });
  const note = field({
    label: 'Message (optional)',
    name: 'note',
    hint: 'For example: I have fallen',
  });
  const ok = await dialog({
    title: 'Get help now?',
    body: h(
      'div',
      { class: 'stack' },
      h(
        'p',
        { class: 'big' },
        'This sends an alert to everyone in your family circle straight away.',
      ),
      h(
        'div',
        { class: 'banner warn' },
        icon('phone'),
        h(
          'p',
          {},
          h('strong', {}, 'In a medical emergency, call 112 now.'),
          ' (Or your local emergency number.)',
        ),
      ),
      share,
      note,
    ),
    actions: [
      { label: 'Cancel', value: false },
      { label: 'Send alert to family', value: true, kind: 'danger' },
    ],
  });
  if (!ok) return;
  announce('Sending alert…');
  let location;
  if (share.control.checked && navigator.geolocation) {
    location = await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracyMeters: p.coords.accuracy,
          }),
        () => resolve(undefined),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      ),
    );
  }
  try {
    const r = await api('/api/sos', {
      method: 'POST',
      body: { location, note: note.control.value.trim() || undefined },
    });
    await dialog({
      title: r.status === 'sent' ? 'Your family has been told' : 'Alert already sent',
      body: h(
        'p',
        { class: 'big' },
        r.status === 'sent'
          ? `${r.sent} ${r.sent === 1 ? 'person was' : 'people were'} emailed${location ? ' with where you are' : ''}.`
          : 'Your alert from a moment ago was already sent.',
      ),
      actions: [{ label: 'OK', value: true, kind: 'primary' }],
    });
  } catch (err) {
    await dialog({
      title: 'Alert not sent',
      body: h('p', { role: 'alert', class: 'big' }, err.message),
      actions: [{ label: 'OK', value: true, kind: 'primary' }],
    });
  }
}

// ---------- Shell ----------
function renderShell(signedIn, tab) {
  clear(nav);
  clear(headerTools);
  nav.hidden = !signedIn;
  if (!signedIn) return;
  nav.append(
    h(
      'ul',
      {},
      TABS.map((t) =>
        h(
          'li',
          {},
          h(
            'a',
            { href: `#/${t.name}`, 'aria-current': t.name === tab ? 'page' : undefined },
            icon(t.icon),
            h('span', {}, t.label),
          ),
        ),
      ),
    ),
  );
  headerTools.append(
    h(
      'button',
      { type: 'button', class: 'button help', onclick: help },
      icon('phone', { size: 20 }),
      'Help',
    ),
  );
}

async function render(opts = {}) {
  stopSpeaking();
  if (!opts.keepScroll) clearToasts();
  const { name, params } = parseHash();
  const s = session.get();
  const route = s ? PRIVATE[name] : PUBLIC[name];
  if (!route) {
    go(s ? '#/today' : '#/welcome');
    return;
  }
  if (s && aiStatusFor !== s.token) {
    aiStatus = await api('/api/ai/status').catch(() => aiStatus);
    aiStatusFor = s.token;
  }
  const ctx = s
    ? { ...s, ai: aiStatus, go, signOut, help, refresh: (o) => render({ keepScroll: true, ...o }) }
    : { go };
  renderShell(Boolean(s), route.tab);
  document.title = `${route.title} — CareCircle`;
  const scroll = window.scrollY;
  main.setAttribute('aria-busy', 'true');
  const fresh = h('div', { class: 'view' });
  try {
    await route.render(fresh, ctx, params);
  } catch (err) {
    fresh.replaceChildren(
      h('h1', { tabindex: '-1' }, 'Something went wrong'),
      h('p', { role: 'alert', class: 'big' }, err.message),
      h(
        'button',
        { type: 'button', class: 'button primary', onclick: () => render() },
        'Try again',
      ),
    );
  }
  main.replaceChildren(fresh);
  main.removeAttribute('aria-busy');
  if (opts.keepScroll) {
    window.scrollTo(0, scroll);
  } else if (!opts.initial) {
    window.scrollTo(0, 0);
    // Move focus to the page heading so screen readers announce the new page.
    main.querySelector('h1')?.focus();
  }
}

async function start() {
  applyPrefs(loadPrefs());
  window.addEventListener('hashchange', () => render());
  window.addEventListener('carecircle:signed-out', () => {
    announce('Please sign in again.', { kind: 'error' });
    go('#/welcome');
  });
  if (session.get()) {
    try {
      session.update(await api('/api/me'));
    } catch {
      /* offline or signed out: render handles it */
    }
  }
  // First load: leave focus alone so keyboard users meet the skip link first.
  await render({ initial: true });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

start();
