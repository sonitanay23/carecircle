import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTestServices,
  seedFamily,
  addMedication,
  createClock,
  fakeGemini,
} from './helpers.js';

const noonIndia = () => createClock(Date.parse('2026-11-15T06:30:00Z'));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function setup(answers) {
  const gemini = fakeGemini(answers);
  const ctx = buildTestServices({ clock: noonIndia(), ai: { gemini } });
  const fam = await seedFamily(ctx.services);
  return { ...ctx, ...fam, gemini };
}

test('AI features say clearly when they are switched off', async () => {
  const { services } = buildTestServices();
  const { pid } = await seedFamily(services);
  assert.equal(services.assistant.enabled, false);
  await assert.rejects(
    services.assistant.checkInteractions(pid),
    (e) => e.status === 503 && e.code === 'AI_DISABLED',
  );
});

test('prescription scan returns cleaned drafts only; nothing is saved', async () => {
  const { services, pid, gemini } = await setup({
    prescription: {
      readable: true,
      medications: [
        {
          name: 'Metformin',
          dose: '500 mg',
          form: 'tablet',
          instructions: 'After food',
          times: ['20:00', '08:00', '8am'],
          asNeeded: false,
          durationDays: 30,
          confidence: 'high',
        },
        {
          name: 'Paracetamol',
          dose: '650 mg',
          form: 'pill',
          times: [],
          asNeeded: true,
          durationDays: null,
          confidence: 'low',
        },
        { name: '', times: ['08:00'], asNeeded: false },
      ],
      warnings: ['Second line partly unreadable'],
    },
  });
  const out = await services.assistant.scanPrescription(pid, {
    contentType: 'image/jpeg',
    buffer: JPEG,
  });
  assert.equal(out.readable, true);
  assert.equal(out.drafts.length, 2, 'nameless entry dropped');
  assert.deepEqual(out.drafts[0].schedule, {
    times: ['08:00', '20:00'],
    startDate: '2026-11-15',
    endDate: '2026-12-14',
  });
  assert.equal(out.drafts[1].form, 'other', 'unknown form normalised');
  assert.equal(out.drafts[1].asNeeded, true);
  assert.equal(out.drafts[1].schedule, null);
  assert.equal(out.drafts[0].needsCheck, false, 'clearly read');
  assert.equal(out.drafts[1].needsCheck, true, 'low confidence is flagged for checking');
  assert.deepEqual(out.warnings, ['Second line partly unreadable']);
  assert.match(out.note, /check every medicine/);
  assert.equal((await services.medications.list(pid)).length, 0, 'drafts are not saved');

  const req = gemini.calls[0];
  assert.equal(req.parts[0].inlineData.mimeType, 'image/jpeg');
  assert.match(req.instruction, /1-0-1 or BD = 08:00 and 20:00/);
  assert.match(req.instruction, /brand names/);
});

test('scan of a non-prescription is reported as unreadable', async () => {
  const { services, pid } = await setup({
    prescription: { readable: false, medications: [], warnings: [] },
  });
  const out = await services.assistant.scanPrescription(pid, {
    contentType: 'image/jpeg',
    buffer: JPEG,
  });
  assert.equal(out.readable, false);
  assert.deepEqual(out.drafts, []);
});

test('medicine explanations are in the chosen language, sent without personal data, and cached', async () => {
  const { services, pid, elder, gemini } = await setup({
    Explain: (req) => ({
      summary: req.instruction.includes('Hindi') ? 'मधुमेह के लिए' : 'Used for diabetes',
      howToTake: 'With food',
      commonSideEffects: ['Upset stomach'],
      askDoctorIf: ['Very tired'],
    }),
  });
  const med = await addMedication(services, pid, elder);
  const first = await services.assistant.explainMedication(pid, med.id, 'hi');
  assert.equal(first.summary, 'मधुमेह के लिए');
  assert.equal(first.cached, false);
  assert.match(first.disclaimer, /not medical advice/);
  const sent = gemini.calls[0].text;
  assert.ok(!/Kamala|kamala@/.test(sent), 'no names or emails sent to Gemini');

  const again = await services.assistant.explainMedication(pid, med.id, 'hi');
  assert.equal(again.cached, true);
  assert.equal(gemini.calls.length, 1, 'second request served from cache');
  await services.assistant.explainMedication(pid, med.id, 'en');
  assert.equal(gemini.calls.length, 2, 'different language is a new answer');
});

test('interaction check drops anything about medicines not on the list', async () => {
  const { services, pid, elder } = await setup({
    interactions: {
      concerns: [
        {
          medicines: ['Metformin', 'Amlodipine'],
          explanation: 'Ask your doctor about taking these together.',
          urgency: 'mention_at_next_visit',
        },
        {
          medicines: ['Warfarin', 'Aspirin'],
          explanation: 'Made-up pair not on the list.',
          urgency: 'ask_soon',
        },
        { medicines: ['Amlodipine'], explanation: '', urgency: 'ask_soon' },
      ],
      summary: 'One thing to mention.',
    },
  });
  await addMedication(services, pid, elder);
  assert.equal(
    (await services.assistant.checkInteractions(pid)).concerns.length,
    0,
    'needs two medicines',
  );
  await addMedication(services, pid, elder, {
    name: 'Amlodipine',
    dose: '5 mg',
    schedule: { times: ['09:00'], startDate: '2026-11-01' },
  });
  const r = await services.assistant.checkInteractions(pid);
  assert.deepEqual(r.checked, ['Amlodipine 5 mg', 'Metformin 500 mg']);
  assert.equal(r.concerns.length, 1);
  assert.equal(r.concerns[0].urgency, 'mention_at_next_visit');
});

test('visit summary uses only CareCircle facts and suggests questions', async () => {
  const { services, pid, elder, gemini } = await setup({
    summary: {
      overview: 'Medicines mostly taken.',
      medicines: 'Evening doses missed twice.',
      readings: 'BP logged 1 time.',
      questionsForDoctor: ['Is my BP ok?', 'Should I change times?'],
    },
  });
  await addMedication(services, pid, elder);
  await services.readings.add(pid, elder, { type: 'bp', systolic: 150, diastolic: 95 });
  const { change } = await services.appointments.proposeCreate(pid, elder, {
    title: 'Diabetes review',
    doctor: 'Dr Iyer',
    date: '2026-11-20',
    time: '10:00',
  });
  const s = await services.assistant.visitSummary(pid, change.targetId);
  assert.deepEqual(s.questionsForDoctor, ['Is my BP ok?', 'Should I change times?']);
  const facts = JSON.parse(gemini.calls[0].text);
  assert.equal(facts.readings[0].outsideTypicalRange, 1);
  assert.equal(facts.medicines[0].name, 'Metformin 500 mg');
  assert.match(gemini.calls[0].instruction, /ONLY the facts given/);
});

test("voice assistant answers from today's data and knows who is asking", async () => {
  const { services, pid, elder, family, gemini } = await setup({
    spoken: { answer: 'Yes, you took it at 8 this morning.', needsDoctor: false },
  });
  const med = await addMedication(services, pid, elder);
  await services.doses.record(pid, elder, {
    medicationId: med.id,
    date: '2026-11-15',
    time: '08:00',
    status: 'taken',
  });
  const r = await services.assistant.ask(pid, elder, {
    question: 'Did I take my sugar tablet today?',
  });
  assert.equal(r.answer, 'Yes, you took it at 8 this morning.');
  const { facts, question } = JSON.parse(gemini.calls[0].text);
  assert.equal(question, 'Did I take my sugar tablet today?');
  assert.deepEqual(
    facts.dosesToday.map((d) => d.status),
    ['taken', 'upcoming'],
  );
  assert.match(gemini.calls[0].instruction, /elder themself/);
  await services.assistant.ask(pid, family, { question: 'Has Mum taken her medicine?' });
  assert.match(gemini.calls[1].instruction, /family member or caretaker/);
});

test('day-before appointment email includes the Gemini visit summary', async () => {
  const { services, pid, elder, email, clock } = await setup({
    summary: {
      overview: 'Medicines taken well this month.',
      medicines: '',
      readings: '',
      questionsForDoctor: ['Can I walk more?'],
    },
  });
  await services.appointments.proposeCreate(pid, elder, {
    title: 'Heart check-up',
    date: '2026-11-16',
    time: '10:00',
  });
  clock.advance(60_000);
  await services.reminders.runAll();
  const mail = email.outbox.find(
    (m) => m.subject === 'Tomorrow: Heart check-up' && m.to === 'kamala@example.com',
  );
  assert.ok(mail);
  assert.match(mail.text, /Before the visit: Medicines taken well this month/);
  assert.match(mail.text, /Can I walk more\?/);
});

test("reminder emails are translated into each person's language; English if translation fails", async () => {
  let fail = false;
  const translator = {
    async translate(texts, lang) {
      if (fail) throw new Error('down');
      return texts.map((t) => `[${lang}] ${t}`);
    },
  };
  const ctx = buildTestServices({
    clock: createClock(Date.parse('2026-11-15T02:20:00Z')),
    ai: { translator },
  });
  const { pid, elder } = await seedFamily(ctx.services);
  await addMedication(ctx.services, pid, elder);
  await ctx.services.reminders.runAll();
  const kamala = ctx.email.outbox.find((m) => m.to === 'kamala@example.com');
  assert.equal(kamala.subject, '[hi] Time for Metformin 500 mg', 'Kamala chose Hindi');
  assert.match(kamala.html, /https:\/\/care\.example\/a\//, 'links are not translated');

  fail = true;
  const sent = await ctx.services.notifier.send(pid, {
    id: 'check',
    kind: 'test',
    recipients: [await ctx.services.profiles.getMember(pid, elder.id)],
    build: () => ({
      subject: 'Hello',
      text: 'x',
      html: 'x',
      parts: { subject: 'Hello', heading: 'h', paragraphs: [], actions: [], footer: 'f' },
    }),
  });
  assert.equal(sent.sent, 1);
  assert.equal(ctx.email.outbox.at(-1).subject, 'Hello', 'falls back to English');
});
