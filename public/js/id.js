/** Public emergency card, opened by scanning the medical ID QR code. */
import { h, set } from './ui.js';

const box = document.getElementById('card');
const token = location.pathname.split('/').pop();

const row = (label, value) => [h('dt', {}, label), h('dd', {}, value)];

fetch(`/api/public/medical-id/${encodeURIComponent(token)}`)
  .then(async (res) => {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message ?? 'This medical ID link is not active.');
    return res.json();
  })
  .then((c) => {
    set(box, 
      h('h1', { tabindex: '-1' }, c.name),
      h(
        'dl',
        { class: 'medical-card' },
        row('Blood group', c.bloodGroup === 'unknown' ? 'Not known' : c.bloodGroup),
        row('Allergies', c.allergies.length ? c.allergies.join(', ') : 'None listed'),
        row('Conditions', c.conditions.length ? c.conditions.join(', ') : 'None listed'),
        row('Current medicines', c.medications?.length ? h('ul', {}, c.medications.map((m) => h('li', {}, `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.instructions ? ` — ${m.instructions}` : ''}`))) : 'None listed'),
        row('Emergency contacts', c.emergencyContacts.length ? h('ul', {}, c.emergencyContacts.map((p) => h('li', {}, `${p.name} (${p.relation}) `, h('a', { class: 'button primary', href: `tel:${p.phone}` }, `Call ${p.phone}`)))) : 'None listed'),
        c.notes ? row('Notes', c.notes) : null,
      ),
      c.updatedAt ? h('p', { class: 'muted' }, `Last updated ${new Date(c.updatedAt).toLocaleDateString()}`) : null,
    );
    box.querySelector('h1').focus();
  })
  .catch((err) => {
    set(box, h('h1', {}, 'Medical ID not available'), h('p', { role: 'alert' }, err.message));
  });
