import { createActivityService } from './activity.js';
import { createProfileService } from './profiles.js';
import { createChangeService } from './changes.js';
import { createMedicalIdService } from './medicalId.js';
import { createMedicationService } from './medications.js';
import { createDoseService } from './doses.js';
import { createAppointmentService } from './appointments.js';
import { createReadingService } from './readings.js';
import { createReminderService } from './reminders.js';
import { createSosService } from './sos.js';
import { createAssistantService } from './assistant.js';
import { createNotifier } from '../notify/notifier.js';
import { createTokenService } from '../lib/tokens.js';

/**
 * Wires every service together. `now` and `channels` are injectable so tests
 * can control time and capture outgoing messages.
 * @param {{ store: object, config: object, logger: object, now?: () => number, channels?: { email?: object },
 *   ai?: { gemini?: object | null, translator?: object | null, speech?: object | null } }} deps
 */
export function buildServices({ store, config, logger, now = () => Date.now(), channels = {}, ai = {} }) {
  const activity = createActivityService({ store, now });
  const profiles = createProfileService({ store, activity, now });
  const changes = createChangeService({ store, activity, profiles, now });
  const medications = createMedicationService({ store, activity, changes, profiles, now });
  const doses = createDoseService({ store, activity, medications, profiles, config, now });
  const appointments = createAppointmentService({ store, activity, changes, profiles, now });
  const readings = createReadingService({ store, activity, now });
  // The emergency card also lists current medicines.
  const extraPublicInfo = async (pid) => ({
    medications: (await medications.active(pid)).map((m) => ({ name: m.name, dose: m.dose ?? null, instructions: m.instructions ?? null })),
  });
  const medicalId = createMedicalIdService({ store, activity, changes, now, config, logger, extraPublicInfo });
  const tokens = createTokenService({ secret: config.sessionSecret, ttlSeconds: config.sessionTtlSeconds, now });
  const notifier = createNotifier({ store, channels, logger, now, translator: ai.translator ?? null });
  const assistant = createAssistantService({ store, gemini: ai.gemini ?? null, profiles, medications, doses, appointments, readings, now });
  const reminders = createReminderService({
    store, profiles, medications, doses, appointments, changes, notifier, tokens, config, logger, now, assistant,
  });
  const sos = createSosService({ profiles, notifier, activity, config, now });
  return { store, activity, profiles, changes, medicalId, medications, doses, appointments, readings, notifier, reminders, sos, assistant, speech: ai.speech ?? null, translator: ai.translator ?? null, tokens, now };
}
