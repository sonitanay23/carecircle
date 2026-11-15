import { api, session } from '../api.js';
import {
  h,
  field,
  busy,
  announce,
  showError,
  confirm,
  dialog,
  copy,
  dateLabel,
  section,
  LANGUAGES,
  timezoneOptions,
  add,
} from '../ui.js';

const ROLE = { elder: 'In charge', family: 'Family', caretaker: 'Caretaker' };

function pendingSection(ctx, changes) {
  const isElder = ctx.me.role === 'elder';
  if (!changes.length)
    return section('Waiting for approval', h('p', { class: 'muted' }, 'Nothing is waiting.'));
  return section(
    'Waiting for approval',
    isElder ? h('p', {}, 'You decide. Nothing changes until you say yes.') : null,
    h(
      'ul',
      { class: 'plain-list' },
      changes.map((c) => {
        const act = async (path, body, msg, button) =>
          busy(button, async () => {
            try {
              await api(`/api/changes/${c.id}/${path}`, { method: 'POST', body });
              announce(msg);
              ctx.refresh();
            } catch (err) {
              announce(err.message, { kind: 'error' });
            }
          });
        return h(
          'li',
          { class: 'card change' },
          h('p', { class: 'big' }, `${c.proposedBy.name} suggested: ${c.summary}`),
          h(
            'p',
            { class: 'muted' },
            dateLabel(c.createdAt, { hour: 'numeric', minute: '2-digit' }),
          ),
          h(
            'div',
            { class: 'button-row' },
            isElder &&
              h(
                'button',
                {
                  type: 'button',
                  class: 'button primary big',
                  onclick: (e) => act('approve', {}, 'Approved.', e.currentTarget),
                },
                '✓ Yes, approve',
              ),
            isElder &&
              h(
                'button',
                {
                  type: 'button',
                  class: 'button secondary',
                  onclick: async (e) => {
                    const button = e.currentTarget;
                    const reasonField = field({
                      label: 'Reason (optional)',
                      name: 'reason',
                      hint: 'This is shown to the person who suggested it.',
                    });
                    const ok = await dialog({
                      title: 'Say no to this change?',
                      body: reasonField,
                      actions: [
                        { label: 'Cancel', value: false },
                        { label: 'Say no', value: true, kind: 'danger' },
                      ],
                    });
                    if (!ok) return;
                    const reason = reasonField.control.value.trim();
                    await act('reject', reason ? { reason } : {}, 'Said no.', button);
                  },
                },
                '✗ No',
              ),
            c.proposedBy.id === ctx.me.id &&
              h(
                'button',
                {
                  type: 'button',
                  class: 'button ghost',
                  onclick: (e) => act('withdraw', {}, 'Withdrawn.', e.currentTarget),
                },
                'Withdraw',
              ),
          ),
        );
      }),
    ),
  );
}

function peopleSection(ctx, members) {
  const isElder = ctx.me.role === 'elder';
  const inviteForm = h(
    'form',
    { class: 'stack' },
    field({ label: 'Their name', name: 'name', required: true }),
    field({
      label: 'They are',
      name: 'role',
      options: [
        { value: 'family', label: 'Family' },
        { value: 'caretaker', label: 'Caretaker' },
      ],
    }),
    h('button', { type: 'submit', class: 'button primary' }, 'Create invite'),
  );
  inviteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(inviteForm));
    await busy(inviteForm.querySelector('button'), async () => {
      try {
        const r = await api('/api/members/invites', { method: 'POST', body: v });
        const message = `Join my CareCircle: ${r.joinUrl}\nCareCircle code: ${r.profileCode}\nInvite code: ${r.inviteCode}`;
        inviteForm.reset();
        // Shown in a dialog so the codes stay visible until the elder is done with them.
        await dialog({
          title: `Invite for ${v.name}`,
          body: h(
            'div',
            { class: 'stack invite-codes' },
            h('p', {}, `Give ${v.name} these codes. The invite works once and lasts 7 days.`),
            h('p', { class: 'code' }, 'CareCircle code: ', h('strong', {}, r.profileCode)),
            h('p', { class: 'code' }, 'Invite code: ', h('strong', {}, r.inviteCode)),
            h(
              'button',
              { type: 'button', class: 'button secondary', onclick: () => copy(message, 'Invite') },
              'Copy invite message',
            ),
          ),
          actions: [{ label: 'Done', value: true, kind: 'primary' }],
        });
        ctx.refresh({ keepScroll: true });
      } catch (err) {
        showError(inviteForm, err);
      }
    });
  });

  return section(
    'People in this CareCircle',
    h(
      'ul',
      { class: 'plain-list' },
      members.map((m) =>
        h(
          'li',
          { class: 'row' },
          h(
            'span',
            {},
            h('strong', {}, m.name),
            ` · ${ROLE[m.role]}`,
            m.status === 'invited' ? ' · invite not used yet' : '',
            m.id === ctx.me.id ? ' (you)' : '',
          ),
          isElder &&
            m.role !== 'elder' &&
            h(
              'button',
              {
                type: 'button',
                class: 'button ghost danger-text',
                onclick: async () => {
                  if (
                    !(await confirm(`Remove ${m.name}?`, 'They will lose access straight away.', {
                      confirmLabel: 'Remove',
                      danger: true,
                    }))
                  )
                    return;
                  try {
                    await api(`/api/members/${m.id}`, { method: 'DELETE' });
                    announce(`${m.name} removed.`);
                    ctx.refresh();
                  } catch (err) {
                    announce(err.message, { kind: 'error' });
                  }
                },
              },
              'Remove',
            ),
        ),
      ),
    ),
    isElder ? h('div', { class: 'stack' }, h('h3', {}, 'Invite someone'), inviteForm) : null,
  );
}

function settingsSection(ctx) {
  const me = ctx.me;
  const f = h(
    'form',
    { class: 'stack' },
    field({
      label: 'Email',
      name: 'email',
      type: 'email',
      value: me.email,
      required: true,
      autocomplete: 'email',
    }),
    field({
      label: 'Phone',
      name: 'phone',
      type: 'tel',
      value: me.phone ?? '',
      autocomplete: 'tel',
    }),
    field({ label: 'Time zone', name: 'timezone', value: me.timezone, options: timezoneOptions() }),
    field({
      label: 'Language for reminders',
      name: 'language',
      value: me.language,
      options: LANGUAGES,
    }),
    field({
      label: 'Send me email reminders',
      name: 'notifyEmail',
      type: 'checkbox',
      value: me.notify?.email,
    }),
    h('button', { type: 'submit', class: 'button primary' }, 'Save my details'),
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        const { me: updated } = await api('/api/me', {
          method: 'PATCH',
          body: {
            email: v.email,
            phone: v.phone || undefined,
            timezone: v.timezone,
            language: v.language,
            notify: { email: v.notifyEmail === 'on' },
          },
        });
        session.update({ me: updated });
        announce('Saved.');
        ctx.refresh();
      } catch (err) {
        showError(f, err);
      }
    });
  });

  const pass = h(
    'form',
    { class: 'stack' },
    field({
      label: 'Current passcode',
      name: 'currentPasscode',
      type: 'password',
      required: true,
      autocomplete: 'current-password',
    }),
    field({
      label: 'New passcode',
      name: 'newPasscode',
      type: 'password',
      required: true,
      minlength: 6,
      autocomplete: 'new-password',
    }),
    h('button', { type: 'submit', class: 'button secondary' }, 'Change passcode'),
  );
  pass.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(pass));
    await busy(pass.querySelector('button'), async () => {
      try {
        const { token } = await api('/api/me/passcode', { method: 'POST', body: v });
        session.update({ token });
        pass.reset();
        announce('Passcode changed. You are signed out everywhere else.');
      } catch (err) {
        showError(pass, err);
      }
    });
  });

  return section(
    'My details',
    f,
    h(
      'button',
      {
        type: 'button',
        class: 'button ghost',
        onclick: (e) =>
          busy(e.currentTarget, async () => {
            try {
              await api('/api/notifications/test', { method: 'POST' });
              announce('Test email sent. Check your inbox.');
            } catch (err) {
              announce(err.message, { kind: 'error' });
            }
          }),
      },
      'Send me a test email',
    ),
    h('details', {}, h('summary', {}, 'Change my passcode'), pass),
  );
}

function elderSettings(ctx) {
  const toggle = field({
    label: 'Family and caretaker changes need my approval',
    name: 'requireApproval',
    type: 'checkbox',
    value: ctx.profile.settings.requireApproval,
    hint: 'Recommended. If off, their changes to medicines and appointments apply straight away (you will still see them in the activity list).',
  });
  toggle.control.addEventListener('change', async () => {
    try {
      const { profile } = await api('/api/profile', {
        method: 'PATCH',
        body: { requireApproval: toggle.control.checked },
      });
      session.update({ profile });
      announce(toggle.control.checked ? 'Approval turned on.' : 'Approval turned off.');
    } catch (err) {
      toggle.control.checked = !toggle.control.checked;
      announce(err.message, { kind: 'error' });
    }
  });
  return section('You are in charge', toggle);
}

function activitySection(items) {
  return section(
    'Recent activity',
    items.length
      ? h(
          'ol',
          { class: 'activity' },
          items.map((a) =>
            h(
              'li',
              {},
              h(
                'span',
                { class: 'muted' },
                dateLabel(a.at, { hour: 'numeric', minute: '2-digit' }),
                ' — ',
              ),
              a.summary,
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Nothing yet.'),
  );
}

function notificationsSection(items) {
  return section(
    'Reminders sent',
    items.length
      ? h(
          'ul',
          { class: 'activity' },
          items.slice(0, 20).map((n) =>
            h(
              'li',
              {},
              h(
                'span',
                { class: 'muted' },
                dateLabel(n.createdAt, { hour: 'numeric', minute: '2-digit' }),
                ' — ',
              ),
              n.subject ?? n.kind,
              ' → ',
              (n.deliveries ?? [])
                .filter((d) => d.status === 'sent')
                .map((d) => d.name)
                .join(', '),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'No reminders sent yet.'),
  );
}

export async function renderCircle(main, ctx) {
  const [{ changes }, { members }, { activity }, { notifications }] = await Promise.all([
    api('/api/changes?status=pending'),
    api('/api/members'),
    api('/api/activity?limit=30'),
    api('/api/notifications'),
  ]);
  add(
    main,
    h('h1', { tabindex: '-1' }, 'Family & settings'),
    h(
      'p',
      { class: 'lead' },
      'CareCircle code: ',
      h('strong', { class: 'code' }, ctx.profile.code),
    ),
    pendingSection(ctx, changes),
    peopleSection(ctx, members),
    ctx.me.role === 'elder' ? elderSettings(ctx) : null,
    settingsSection(ctx),
    activitySection(activity),
    notificationsSection(notifications),
    h(
      'button',
      { type: 'button', class: 'button secondary', onclick: () => ctx.signOut() },
      'Sign out',
    ),
  );
}
