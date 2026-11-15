/**
 * Pure medication-schedule logic: which doses fall on a date, and how many
 * days of tablets are left. Kept free of I/O so it is easy to test.
 */
import { weekday, zonedToUtc } from './time.js';

/** Is the medication meant to be taken on this local date? */
export function isScheduledOn(med, date) {
  if (med.asNeeded || !med.schedule) return false;
  const { startDate, endDate, days } = med.schedule;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  if (med.stoppedOn && date >= med.stoppedOn) return false;
  if (days?.length && !days.includes(weekday(date))) return false;
  return true;
}

export const doseKey = (medicationId, date, time) =>
  `${medicationId}_${date}_${time.replace(':', '')}`;

/** Scheduled doses for one medication on one local date. */
export function dosesOn(med, date, timeZone) {
  if (!isScheduledOn(med, date)) return [];
  return med.schedule.times.map((time) => ({
    key: doseKey(med.id, date, time),
    medicationId: med.id,
    date,
    time,
    scheduledAt: new Date(zonedToUtc(date, time, timeZone)).toISOString(),
  }));
}

/** Average doses per day (accounts for medicines taken only on some weekdays). */
export function dosesPerDay(med) {
  if (med.asNeeded || !med.schedule?.times?.length) return 0;
  const daysPerWeek = med.schedule.days?.length ? med.schedule.days.length : 7;
  return (med.schedule.times.length * daysPerWeek) / 7;
}

/**
 * Supply status for refill tracking.
 * @returns {{ count: number, daysLeft: number | null, low: boolean } | null}
 */
export function supplyStatus(med) {
  if (!med.stock || typeof med.stock.count !== 'number') return null;
  const perDay = dosesPerDay(med) * (med.stock.perDose ?? 1);
  const daysLeft = perDay > 0 ? Math.floor(med.stock.count / perDay) : null;
  const lowAt = med.stock.lowAtDays ?? 5;
  return {
    count: med.stock.count,
    perDose: med.stock.perDose ?? 1,
    lowAtDays: lowAt,
    daysLeft,
    low: daysLeft !== null ? daysLeft <= lowAt : med.stock.count <= (med.stock.perDose ?? 1) * 2,
  };
}
