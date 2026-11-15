import { paths } from '../store/index.js';
import { HttpError } from '../lib/httpError.js';
import { sha256 } from '../lib/ids.js';
import { addDays, localDate } from '../lib/time.js';
import { S } from '../ai/gemini.js';
import { MEDICATION_FORMS } from './medications.js';

export const LANGUAGE_NAMES = Object.freeze({
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', mr: 'Marathi',
  gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', ur: 'Urdu',
});

export const DISCLAIMER = 'This is general information, not medical advice. Always check with your doctor or pharmacist.';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
const list = (a, n, len = 200) => (Array.isArray(a) ? a.map((x) => clip(x, len)).filter(Boolean).slice(0, n) : []);
const langLine = (lang) => `Answer in ${LANGUAGE_NAMES[lang] ?? 'English'}. Keep medicine names as written.`;
const medLabel = (m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}`;

const disabled = () =>
  new HttpError(503, 'The AI helper is not switched on for this CareCircle yet.', 'AI_DISABLED');

/**
 * Gemini-powered helpers. Every one of them:
 *  - only ever suggests; nothing is saved without a person confirming it,
 *  - sends Gemini only the data it needs (no names, emails or phone numbers),
 *  - validates Gemini's answer before using it,
 *  - caches answers that do not change, to save time and cost.
 */
export function createAssistantService({ store, gemini, profiles, medications, doses, appointments, readings, now }) {
  const cache = (pid) => store.collection(paths.aiCache(pid));
  const client = () => {
    if (!gemini) throw disabled();
    return gemini;
  };

  /** Returns a cached answer, or computes, stores and returns a new one. */
  async function cached(pid, key, compute) {
    const id = sha256(key).slice(0, 40);
    const hit = await cache(pid).get(id);
    if (hit) return { ...hit.value, cached: true };
    const value = await compute();
    await cache(pid).set(id, { key: key.slice(0, 200), value, createdAt: new Date(now()).toISOString() });
    return { ...value, cached: false };
  }

  const api = {
    enabled: Boolean(gemini),

    /**
     * Reads a photo of a prescription or medicine box and returns DRAFT
     * medicines for a person to check. Indian dosing shorthand (1-0-1, BD, TDS,
     * HS, SOS) is converted to times.
     */
    async scanPrescription(pid, { contentType, buffer }) {
      const g = client();
      const profile = await profiles.getProfile(pid);
      const today = localDate(now(), profile.timezone);
      const result = await g.generateJson({
        instruction: [
          'Read this photo of a prescription (printed or handwritten, often from India), a medicine strip, or a medicine box, and list each medicine.',
          'The photo may be rotated, blurry or taken at an angle; read it as well as you can.',
          'Medicines are often written as brand names (e.g. "Tab. Glycomet 500", "Telma 40", "Cap. Pan-D", "Syp. Ascoril"). Use the name as written, without "Tab."/"Cap."/"Syp.", and put the strength (500 mg, 40 mg, 5 ml) in dose.',
          'Convert dosing shorthand to 24-hour times: 1-0-0 or OD = 08:00; 0-1-0 = 14:00; 0-0-1 or HS = 22:00 (bedtime) unless "night" suggests 20:00;',
          '1-0-1 or BD = 08:00 and 20:00; 1-1-1 or TDS = 08:00, 14:00 and 20:00; QID = 08:00, 12:00, 16:00 and 20:00. "½" or "1/2" means half a tablet: say so in instructions.',
          'AC = before food, PC = after food, empty stomach = before breakfast: put these in instructions in plain words.',
          'SOS or PRN means "when needed": set asNeeded true and leave times empty.',
          'If the duration is written (e.g. "x 5 days", "for 1 month", "1/12" = 1 month, "2/52" = 2 weeks), give durationDays.',
          'Set confidence to "high" only when the name and timing are clearly readable; otherwise "low". Never guess a dose you cannot read; leave it empty and add a warning.',
          'Ignore the doctor\'s name, clinic, patient details, signatures and stamps.',
          'If the image is not a prescription or medicine at all, set readable to false.',
        ].join(' '),
        parts: [{ inlineData: { mimeType: contentType, data: buffer.toString('base64') } }],
        schema: S.obj(
          {
            readable: S.bool(),
            medications: S.arr(
              S.obj(
                {
                  name: S.str(),
                  dose: S.str('strength, e.g. 500 mg'),
                  form: S.enum([...MEDICATION_FORMS]),
                  instructions: S.str(),
                  times: S.arr(S.str('HH:MM, 24-hour')),
                  asNeeded: S.bool(),
                  durationDays: S.num(),
                  confidence: S.enum(['high', 'low']),
                },
                ['name', 'times', 'asNeeded', 'confidence'],
              ),
            ),
            warnings: S.arr(S.str()),
          },
          ['readable', 'medications', 'warnings'],
        ),
      });

      // Never trust model output blindly: clean every field.
      const drafts = (Array.isArray(result.medications) ? result.medications : [])
        .slice(0, 15)
        .map((m) => {
          const name = clip(m.name, 80);
          if (!name) return null;
          const times = [...new Set(list(m.times, 8, 5).filter((t) => TIME.test(t)))].sort();
          const asNeeded = Boolean(m.asNeeded) || times.length === 0;
          const days = Number.isFinite(m.durationDays) && m.durationDays > 0 && m.durationDays <= 365 ? Math.round(m.durationDays) : null;
          return {
            name,
            dose: clip(m.dose, 40) || undefined,
            form: MEDICATION_FORMS.includes(m.form) ? m.form : 'other',
            instructions: clip(m.instructions, 200) || undefined,
            asNeeded,
            schedule: asNeeded ? null : { times, startDate: today, endDate: days ? addDays(today, days - 1) : null },
            // Anything Gemini was not sure about is clearly marked for checking.
            needsCheck: m.confidence !== 'high' || (!asNeeded && times.length === 0),
          };
        })
        .filter(Boolean);

      return {
        readable: Boolean(result.readable) && drafts.length > 0,
        drafts,
        warnings: list(result.warnings, 10),
        note: 'Please check every medicine against the prescription before saving. Ask your pharmacist if anything is unclear.',
        disclaimer: DISCLAIMER,
      };
    },

    /** Plain-language explanation of one medicine, in the reader's language. */
    async explainMedication(pid, medicationId, lang = 'en') {
      const g = client();
      const med = await medications.getRaw(pid, medicationId);
      if (!med) throw new HttpError(404, 'Medicine not found', 'NOT_FOUND');
      return cached(pid, `explain|${lang}|${med.name}|${med.dose ?? ''}|${med.instructions ?? ''}`, async () => {
        const r = await g.generateJson({
          instruction: `Explain this medicine to an older person in plain words. ${langLine(lang)} If you do not recognise it, say so in "summary" and leave the lists empty.`,
          text: JSON.stringify({ medicine: med.name, strength: med.dose ?? null, form: med.form ?? null, instructionsOnLabel: med.instructions ?? null }),
          schema: S.obj({
            summary: S.str('what it is usually used for, 1-2 sentences'),
            howToTake: S.str('general tips such as with food, at the same time each day'),
            commonSideEffects: S.arr(S.str()),
            askDoctorIf: S.arr(S.str('signs to call the doctor about')),
          }),
        });
        return {
          medicine: medLabel(med),
          language: lang,
          summary: clip(r.summary, 600),
          howToTake: clip(r.howToTake, 600),
          commonSideEffects: list(r.commonSideEffects, 6),
          askDoctorIf: list(r.askDoctorIf, 6),
          disclaimer: DISCLAIMER,
        };
      });
    },

    /** Flags possible clashes between current medicines, as "ask your doctor". */
    async checkInteractions(pid, lang = 'en') {
      const g = client();
      const active = await medications.active(pid);
      const names = active.map(medLabel).sort();
      if (names.length < 2) {
        return { checked: names, concerns: [], summary: 'There need to be at least two medicines to check.', disclaimer: DISCLAIMER, cached: false };
      }
      return cached(pid, `interactions|${lang}|${names.join('|')}`, async () => {
        const r = await g.generateJson({
          instruction: [
            'Check this list of medicines for well-known possible interactions or duplicate medicines (two with the same active ingredient).',
            'Only mention well-established concerns. Do not alarm. For each, explain simply and say to ask the doctor or pharmacist.',
            'urgency is "ask_soon" for important concerns and "mention_at_next_visit" for minor ones.',
            langLine(lang),
          ].join(' '),
          text: JSON.stringify({ medicines: names }),
          schema: S.obj({
            concerns: S.arr(S.obj({ medicines: S.arr(S.str()), explanation: S.str(), urgency: S.enum(['ask_soon', 'mention_at_next_visit']) })),
            summary: S.str(),
          }),
        });
        // First word of each medicine name ("Metformin 500 mg" -> "metformin").
        const known = active.map((m) => m.name.toLowerCase().split(/\s+/)[0]);
        const mentionsKnown = (medName) => known.some((k) => medName.toLowerCase().includes(k));
        return {
          checked: names,
          concerns: (Array.isArray(r.concerns) ? r.concerns : [])
            .slice(0, 10)
            .map((c) => ({
              medicines: list(c.medicines, 4, 80),
              explanation: clip(c.explanation, 400),
              urgency: c.urgency === 'ask_soon' ? 'ask_soon' : 'mention_at_next_visit',
            }))
            // Drop anything about medicines that are not on the list.
            .filter((c) => c.explanation && c.medicines.some(mentionsKnown)),
          summary: clip(r.summary, 400),
          disclaimer: DISCLAIMER,
        };
      });
    },

    /** One-page summary to take to a doctor's appointment. */
    async visitSummary(pid, appointmentId, lang = 'en') {
      const g = client();
      const appt = await appointments.get(pid, appointmentId);
      const [adherence, readingData, active] = await Promise.all([
        doses.adherence(pid, { days: 30 }),
        readings.list(pid, { days: 30 }),
        medications.active(pid),
      ]);
      const facts = {
        appointment: { title: appt.title, doctor: appt.doctor ?? null, specialty: appt.specialty ?? null, date: appt.date },
        medicines: active.map((m) => ({ name: medLabel(m), times: m.asNeeded ? 'when needed' : m.schedule.times, instructions: m.instructions ?? null })),
        last30Days: {
          adherencePercent: adherence.totals.adherencePercent,
          taken: adherence.totals.taken,
          expected: adherence.totals.expected,
          missed: adherence.totals.missed,
          skipped: adherence.totals.skipped,
          perMedicine: adherence.medications.map((m) => ({ name: m.name, taken: m.taken, expected: m.expected, late: m.late })),
        },
        readings: readingData.summary.map((s) => ({ type: s.label, count: s.count, average: s.average, latest: s.latest.display, outsideTypicalRange: s.flagged })),
      };
      return cached(pid, `visit|${lang}|${appointmentId}|${localDate(now(), 'UTC')}|${sha256(JSON.stringify(facts))}`, async () => {
        const r = await g.generateJson({
          instruction: [
            'Write a short summary for an older person to bring to this doctor appointment, using ONLY the facts given.',
            'Do not interpret readings or suggest treatment. Point out patterns (e.g. evening doses often missed) and suggest 3-5 questions to ask the doctor.',
            langLine(lang),
          ].join(' '),
          text: JSON.stringify(facts),
          schema: S.obj({
            overview: S.str(),
            medicines: S.str('how regularly medicines were taken, any patterns'),
            readings: S.str('what was measured, without interpreting'),
            questionsForDoctor: S.arr(S.str()),
          }),
        });
        return {
          appointment: { id: appt.id, title: appt.title, date: appt.date, time: appt.time },
          language: lang,
          overview: clip(r.overview, 600),
          medicines: clip(r.medicines, 800),
          readings: clip(r.readings, 800),
          questionsForDoctor: list(r.questionsForDoctor, 6, 200),
          facts,
          disclaimer: DISCLAIMER,
        };
      });
    },

    /**
     * Voice assistant: answers a question using ONLY today's CareCircle data,
     * e.g. "Did I take my BP tablet today?" or "When is my next appointment?".
     */
    async ask(pid, member, { question, lang = 'en' }) {
      const g = client();
      const [today, adherence, upcoming, active, readingData] = await Promise.all([
        doses.today(pid),
        doses.adherence(pid, { days: 7 }),
        appointments.list(pid, { when: 'upcoming' }),
        medications.active(pid),
        readings.list(pid, { days: 14 }),
      ]);
      const facts = {
        askedBy: member.role,
        today: today.date,
        dosesToday: today.doses.map((d) => ({ medicine: `${d.name}${d.dose ? ` ${d.dose}` : ''}`, time: d.time, status: d.status, purpose: active.find((m) => m.id === d.medicationId)?.purpose ?? null })),
        whenNeededTakenToday: today.asNeededTaken.map((r) => r.medicationName),
        last7Days: { adherencePercent: adherence.totals.adherencePercent, missed: adherence.totals.missed, streakDays: adherence.streakDays },
        nextAppointments: upcoming.slice(0, 3).map((a) => ({ title: a.title, date: a.date, time: a.time, doctor: a.doctor ?? null, place: a.location?.name ?? null })),
        latestReadings: readingData.summary.map((s) => ({ type: s.label, latest: s.latest.display, takenAt: s.latest.takenAt })),
      };
      const r = await g.generateJson({
        instruction: [
          'Answer the question in 1-3 short spoken sentences using ONLY these CareCircle facts. Times are local 24-hour; say them naturally (e.g. "8 in the morning").',
          'If the facts do not answer it, say you do not know and suggest asking family or the doctor. If they ask whether to take a dose now, do not decide: tell them what the schedule says and to check with their pharmacist if unsure.',
          `The person asking is the ${member.role === 'elder' ? 'elder themself (use "you")' : 'family member or caretaker of the elder'}.`,
          langLine(lang),
        ].join(' '),
        text: JSON.stringify({ facts, question }),
        schema: S.obj({ answer: S.str(), needsDoctor: S.bool() }),
      });
      return { answer: clip(r.answer, 500) || 'Sorry, I could not answer that. Please ask your family or doctor.', needsDoctor: Boolean(r.needsDoctor), language: lang };
    },
  };
  return api;
}
