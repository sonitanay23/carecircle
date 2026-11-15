/**
 * Reminder messages. Each message is built per recipient, so times are shown
 * in that person's own time zone. Every message has a plain-text version and
 * an accessible, large-text HTML version.
 */
import { formatForPerson } from '../lib/time.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const medLabel = (m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}`;
const firstName = (name) => String(name).split(' ')[0];

/** "8:00 pm" for the recipient, plus the elder's local time if it differs. */
function whenFor(recipient, ms, elder) {
  const mine = formatForPerson(ms, recipient.timezone ?? elder.timezone);
  if (!elder || (recipient.timezone ?? elder.timezone) === elder.timezone) return mine;
  return `${mine} your time (${formatForPerson(ms, elder.timezone)} for ${firstName(elder.name)})`;
}

export const DISCLAIMER = 'CareCircle does not give medical advice. If you are unsure, ask your doctor or pharmacist.';

/** Wraps content in a simple, accessible email layout (large text, high contrast). */
function emailHtml({ heading, paragraphs, actions = [], footer }) {
  const buttons = actions
    .map(
      (a) =>
        `<p style="margin:16px 0"><a href="${esc(a.url)}" style="display:inline-block;background:#0b3d5c;color:#ffffff;padding:14px 22px;border-radius:8px;font-size:20px;text-decoration:none">${esc(a.label)}</a></p>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><body style="margin:0;background:#ffffff">
<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.6;color:#111111">
<h1 style="font-size:26px;line-height:1.3;margin:0 0 16px">${esc(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join('')}
${buttons}
<p style="margin-top:24px;font-size:16px;color:#444444">${esc(footer ?? DISCLAIMER)}</p>
</div></body></html>`;
}

/**
 * Builds { subject, text, html } from parts. The parts are kept too, so the
 * notifier can translate them into the recipient's language and rebuild.
 */
export function buildMessage({ subject, heading, paragraphs, actions = [], footer = DISCLAIMER }) {
  const text = [heading, ...paragraphs, ...actions.map((a) => `${a.label}: ${a.url}`), footer].join('\n\n');
  return { subject, text, html: emailHtml({ heading, paragraphs, actions, footer }), parts: { subject, heading, paragraphs, actions, footer } };
}
const build = buildMessage;

export const messages = {
  dose_upcoming({ recipient, elder, med, dose, actionUrl, appUrl }) {
    const when = whenFor(recipient, Date.parse(dose.scheduledAt), elder);
    const isElder = recipient.id === elder.id;
    return build({
      subject: isElder ? `Time for ${medLabel(med)}` : `${firstName(elder.name)}'s ${medLabel(med)} is due`,
      heading: isElder ? `Time for your medicine, ${firstName(elder.name)}` : `${firstName(elder.name)}'s medicine is due`,
      paragraphs: [`${medLabel(med)} at ${when}.`, med.instructions ? `How to take it: ${med.instructions}.` : null].filter(Boolean),
      actions: [actionUrl && { label: isElder ? "I've taken it" : 'Mark as taken', url: actionUrl }, { label: 'Open CareCircle', url: appUrl }].filter(Boolean),
    });
  },

  dose_missed({ recipient, elder, med, dose, actionUrl, appUrl }) {
    const when = whenFor(recipient, Date.parse(dose.scheduledAt), elder);
    const isElder = recipient.id === elder.id;
    return build({
      subject: isElder ? `Did you take ${medLabel(med)}?` : `${firstName(elder.name)} may have missed ${medLabel(med)}`,
      heading: isElder ? `Did you take ${medLabel(med)}?` : `${firstName(elder.name)} may have missed a dose`,
      paragraphs: [
        `${medLabel(med)} was due at ${when} and has not been marked as taken.`,
        isElder ? 'If you took it, tap the button below.' : `If ${firstName(elder.name)} took it, you can mark it below.`,
        'If you are not sure what to do about a missed dose, ask your pharmacist or doctor.',
      ],
      actions: [actionUrl && { label: isElder ? "Yes, I've taken it" : 'Mark as taken', url: actionUrl }, { label: 'Open CareCircle', url: appUrl }].filter(Boolean),
    });
  },

  dose_escalated({ recipient, elder, med, dose, appUrl }) {
    const when = whenFor(recipient, Date.parse(dose.scheduledAt), elder);
    return build({
      subject: `Please check on ${firstName(elder.name)}: ${medLabel(med)} not taken`,
      heading: `${firstName(elder.name)} has not taken ${medLabel(med)}`,
      paragraphs: [
        `It was due at ${when}. ${firstName(elder.name)} was reminded but it is still not marked as taken.`,
        `You may want to call ${firstName(elder.name)}${elder.phone ? ` on ${elder.phone}` : ''} to check in.`,
      ],
      actions: [elder.phone && { label: `Call ${firstName(elder.name)}`, url: `tel:${elder.phone}` }, { label: 'Open CareCircle', url: appUrl }].filter(Boolean),
    });
  },

  appointment({ recipient, elder, appointment, soon, appUrl, visitSummary }) {
    const when = whenFor(recipient, Date.parse(appointment.startsAt), elder);
    const place = [appointment.location?.name, appointment.location?.address].filter(Boolean).join(', ');
    const who = recipient.id === elder.id ? 'You have' : `${firstName(elder.name)} has`;
    return build({
      subject: `${soon ? 'Soon' : 'Tomorrow'}: ${appointment.title}`,
      heading: `${who} ${appointment.title} ${soon ? 'soon' : 'coming up'}`,
      paragraphs: [
        `${when}${appointment.doctor ? ` with ${appointment.doctor}` : ''}.`,
        place ? `Where: ${place}.` : null,
        soon ? 'Remember to take your medicine list and any reports.' : null,
        visitSummary?.overview ? `Before the visit: ${visitSummary.overview}` : null,
        visitSummary?.questionsForDoctor?.length ? `Questions you might ask: ${visitSummary.questionsForDoctor.join(' • ')}` : null,
      ].filter(Boolean),
      actions: [
        appointment.links?.directions && { label: 'Get directions', url: appointment.links.directions },
        !soon && appointment.links?.googleCalendar && { label: 'Add to Google Calendar', url: appointment.links.googleCalendar },
        { label: 'Open CareCircle', url: appUrl },
      ].filter(Boolean),
    });
  },

  low_stock({ recipient, elder, med, supply, appUrl, pharmacyUrl }) {
    const whose = recipient.id === elder.id ? 'Your' : `${firstName(elder.name)}'s`;
    return build({
      subject: `Running low: ${medLabel(med)}`,
      heading: `${whose} ${medLabel(med)} is running low`,
      paragraphs: [
        supply.daysLeft !== null
          ? `About ${supply.daysLeft} day${supply.daysLeft === 1 ? '' : 's'} left (${supply.count} remaining).`
          : `${supply.count} remaining.`,
        'Please arrange a refill soon. When it is bought, add it in CareCircle so the count stays right.',
      ],
      actions: [{ label: 'Find a pharmacy', url: pharmacyUrl }, { label: 'Open CareCircle', url: appUrl }],
    });
  },

  approval_needed({ elder, change, appUrl }) {
    return build({
      subject: `${change.proposedBy.name} suggested a change`,
      heading: `${firstName(elder.name)}, please check a suggested change`,
      paragraphs: [`${change.proposedBy.name} suggested: ${change.summary}.`, 'Nothing changes until you say yes.'],
      actions: [{ label: 'Review in CareCircle', url: appUrl }],
      footer: 'You are in charge of your own care. You can say yes or no to any change.',
    });
  },

  weekly_summary({ recipient, elder, adherence, appUrl }) {
    const t = adherence.totals;
    const who = recipient.id === elder.id ? 'You' : firstName(elder.name);
    const lines = adherence.medications.map((m) => `${m.name}: ${m.taken} of ${m.expected} taken${m.missed ? `, ${m.missed} missed` : ''}.`);
    return build({
      subject: `Weekly summary for ${firstName(elder.name)}: ${t.adherencePercent ?? 0}% of doses taken`,
      heading: `This week, ${who} took ${t.taken} of ${t.expected} doses`,
      paragraphs: [
        ...lines,
        adherence.streakDays > 1 ? `${adherence.streakDays} days in a row with every dose taken. Well done!` : null,
      ].filter(Boolean),
      actions: [{ label: 'See details', url: appUrl }],
    });
  },

  sos({ recipient, sender, elder, location, note, sentAt, appUrl }) {
    const from = sender.id === elder.id ? firstName(sender.name) : `${firstName(sender.name)} (for ${firstName(elder.name)})`;
    const when = formatForPerson(sentAt, recipient.timezone ?? elder.timezone);
    const where = location
      ? `Location: ${location.mapUrl}${location.accuracyMeters ? ` (within about ${Math.round(location.accuracyMeters)} m)` : ''}`
      : 'No location was shared.';
    return build({
      subject: `SOS: ${firstName(elder.name)} needs help`,
      heading: `SOS from ${from}`,
      paragraphs: [
        `Sent ${when}. Please contact them right away.`,
        note ? `Message: ${note}` : null,
        where,
        'If you cannot reach them and it may be an emergency, call the local emergency number for where they are.',
      ].filter(Boolean),
      actions: [
        location && { label: 'Open the location in Google Maps', url: location.mapUrl },
        sender.phone && { label: `Call ${firstName(sender.name)}`, url: `tel:${sender.phone}` },
        elder.phone && sender.id !== elder.id && { label: `Call ${firstName(elder.name)}`, url: `tel:${elder.phone}` },
        { label: 'Open CareCircle', url: appUrl },
      ].filter(Boolean),
      footer: 'CareCircle is not an emergency service. In an emergency, call your local emergency number.',
    });
  },

  test({ recipient }) {
    return build({
      subject: 'CareCircle test message',
      heading: `Hello ${firstName(recipient.name)}`,
      paragraphs: ['This is a test message from CareCircle. Reminders will reach you here.'],
    });
  },
};
