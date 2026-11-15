import { api } from '../api.js';
import { h, field, busy, announce, showError, confirm, copy, section, add, set } from '../ui.js';

const GROUPS = ['unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const lines = (s) => String(s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

function cardView(card, profile) {
  return h(
    'div',
    { class: 'medical-card printable' },
    h('p', { class: 'brand' }, 'Medical ID'),
    h('p', { class: 'card-name' }, profile.elderName),
    h('dl', {},
      h('dt', {}, 'Blood group'), h('dd', {}, card.bloodGroup === 'unknown' ? 'Not known' : card.bloodGroup),
      h('dt', {}, 'Allergies'), h('dd', {}, card.allergies.length ? card.allergies.join(', ') : 'None listed'),
      h('dt', {}, 'Conditions'), h('dd', {}, card.conditions.length ? card.conditions.join(', ') : 'None listed'),
      h('dt', {}, 'Emergency contacts'),
      h('dd', {}, card.emergencyContacts.length ? h('ul', {}, card.emergencyContacts.map((c) => h('li', {}, `${c.name} (${c.relation}) `, h('a', { href: `tel:${c.phone}` }, c.phone)))) : 'None listed'),
      card.notes ? [h('dt', {}, 'Notes'), h('dd', {}, card.notes)] : null,
    ),
  );
}

function editForm(ctx, card) {
  const contacts = h('div', { class: 'stack' });
  const addContact = (c = {}) => {
    const row = h(
      'fieldset',
      { class: 'fieldset' },
      h('legend', {}, 'Emergency contact'),
      field({ label: 'Name', name: 'cName', value: c.name }),
      field({ label: 'Relation', name: 'cRelation', value: c.relation, hint: 'e.g. Daughter' }),
      field({ label: 'Phone', name: 'cPhone', type: 'tel', value: c.phone, hint: 'With country code' }),
      h('button', { type: 'button', class: 'button ghost', onclick: () => row.remove() }, 'Remove contact'),
    );
    contacts.append(row);
  };
  (card.emergencyContacts.length ? card.emergencyContacts : [{}]).forEach(addContact);

  const f = h(
    'form',
    { class: 'stack' },
    field({ label: 'Blood group', name: 'bloodGroup', value: card.bloodGroup, options: GROUPS.map((g) => ({ value: g, label: g === 'unknown' ? 'Not known' : g })) }),
    field({ label: 'Allergies (one per line)', name: 'allergies', multiline: true, value: card.allergies.join('\n') }),
    field({ label: 'Conditions (one per line)', name: 'conditions', multiline: true, value: card.conditions.join('\n') }),
    contacts,
    h('button', { type: 'button', class: 'button ghost', onclick: () => addContact() }, '+ Add a contact'),
    field({ label: 'Other notes for doctors', name: 'notes', multiline: true, value: card.notes, hint: 'e.g. Wears a hearing aid' }),
    h('button', { type: 'submit', class: 'button primary' }, 'Save medical ID'),
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const names = fd.getAll('cName');
    const relations = fd.getAll('cRelation');
    const phones = fd.getAll('cPhone');
    const body = {
      bloodGroup: fd.get('bloodGroup'),
      allergies: lines(fd.get('allergies')),
      conditions: lines(fd.get('conditions')),
      emergencyContacts: names.map((name, i) => ({ name: name.trim(), relation: relations[i].trim(), phone: phones[i].trim() })).filter((c) => c.name && c.phone),
      notes: fd.get('notes') || undefined,
    };
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        const r = await api('/api/medical-id', { method: 'PUT', body });
        announce(r.status === 'pending' ? 'Sent for approval.' : 'Medical ID saved.');
        ctx.refresh();
      } catch (err) {
        showError(f, err);
      }
    });
  });
  return f;
}

function sharingSection(ctx, card) {
  const isElder = ctx.me.role === 'elder';
  const qr = h('img', { class: 'qr', alt: 'QR code that opens the medical ID', width: 220, height: 220, hidden: true });
  if (card.sharing.enabled) {
    api('/api/medical-id/qr.svg', { as: 'blob' }).then((b) => { qr.src = URL.createObjectURL(b); qr.hidden = false; }).catch(() => {});
  }
  const toggle = async (method, button, message) =>
    busy(button, async () => {
      try {
        await api('/api/medical-id/sharing', { method });
        announce(message);
        ctx.refresh();
      } catch (err) {
        announce(err.message, { kind: 'error' });
      }
    });
  return section(
    'Emergency link and QR code',
    h('p', {}, 'A paramedic or doctor can scan this QR code to see the card above, without a passcode. Print it for a wallet or the fridge.'),
    card.sharing.enabled
      ? h(
          'div',
          { class: 'stack' },
          h('div', { class: 'printable qr-print' }, qr, h('p', { class: 'muted' }, 'Scan for medical ID')),
          h('p', { class: 'code' }, card.sharing.url),
          h(
            'div',
            { class: 'button-row no-print' },
            h('button', { type: 'button', class: 'button secondary', onclick: () => window.print() }, '🖨 Print card and QR'),
            h('button', { type: 'button', class: 'button secondary', onclick: () => copy(card.sharing.url, 'Link') }, 'Copy link'),
            isElder && h('button', { type: 'button', class: 'button ghost', onclick: async (e) => { if (await confirm('Make a new link?', 'Old printed QR codes will stop working.', { confirmLabel: 'Make new link' })) toggle('POST', e.target, 'New link made.'); } }, 'Make a new link'),
            isElder && h('button', { type: 'button', class: 'button ghost danger-text', onclick: (e) => toggle('DELETE', e.currentTarget, 'Link turned off.') }, 'Turn off link'),
          ),
        )
      : isElder
        ? h('button', { type: 'button', class: 'button primary', onclick: (e) => toggle('POST', e.currentTarget, 'Link turned on.') }, 'Turn on the emergency link')
        : h('p', { class: 'muted' }, 'Only the elder can turn this on.'),
  );
}

export async function renderMedicalId(main, ctx) {
  const { medicalId } = await api('/api/medical-id');
  const editArea = h('div');
  add(main, 
    h('h1', { tabindex: '-1' }, 'Medical ID'),
    cardView(medicalId, ctx.profile),
    h('button', { type: 'button', class: 'button secondary no-print', onclick: (e) => { set(editArea, section('Edit medical ID', editForm(ctx, medicalId))); e.currentTarget.remove(); } }, 'Edit'),
    editArea,
    sharingSection(ctx, medicalId),
  );
}
