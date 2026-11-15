import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, localTime, zonedToUtc, addDays, weekday, dateRange } from '../src/lib/time.js';
import { dosesOn, supplyStatus, dosesPerDay, isScheduledOn } from '../src/lib/schedule.js';
import { googleCalendarUrl, googleMapsDirectionsUrl } from '../src/lib/links.js';

test('converts India local time to UTC (UTC+5:30)', () => {
  assert.equal(
    new Date(zonedToUtc('2026-11-15', '08:00', 'Asia/Kolkata')).toISOString(),
    '2026-11-15T02:30:00.000Z',
  );
});

test('handles daylight saving in the US', () => {
  // 8am in Los Angeles is UTC-7 in summer and UTC-8 in winter.
  assert.equal(
    new Date(zonedToUtc('2026-07-01', '08:00', 'America/Los_Angeles')).toISOString(),
    '2026-07-01T15:00:00.000Z',
  );
  assert.equal(
    new Date(zonedToUtc('2026-12-01', '08:00', 'America/Los_Angeles')).toISOString(),
    '2026-12-01T16:00:00.000Z',
  );
});

test('local date and time differ by person', () => {
  const t = Date.parse('2026-11-15T02:30:00Z');
  assert.equal(localDate(t, 'Asia/Kolkata'), '2026-11-15');
  assert.equal(localTime(t, 'Asia/Kolkata'), '08:00');
  assert.equal(localDate(t, 'America/Los_Angeles'), '2026-11-14');
  assert.equal(localTime(t, 'America/Los_Angeles'), '18:30');
});

test('date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday('2026-11-15'), 0); // Sunday
  assert.deepEqual(dateRange('2026-11-14', '2026-11-16'), [
    '2026-11-14',
    '2026-11-15',
    '2026-11-16',
  ]);
});

const med = {
  id: 'm1',
  schedule: { times: ['08:00', '20:00'], days: [], startDate: '2026-11-01', endDate: null },
  stock: { count: 20, perDose: 1, lowAtDays: 5 },
};

test('schedules respect start, end, weekdays and stop date', () => {
  assert.equal(isScheduledOn(med, '2026-10-31'), false);
  assert.equal(isScheduledOn(med, '2026-11-15'), true);
  assert.equal(
    isScheduledOn({ ...med, schedule: { ...med.schedule, days: [1, 3, 5] } }, '2026-11-15'),
    false,
  );
  assert.equal(isScheduledOn({ ...med, stoppedOn: '2026-11-10' }, '2026-11-15'), false);
  assert.equal(isScheduledOn({ ...med, asNeeded: true }, '2026-11-15'), false);
});

test('dosesOn returns keyed doses with UTC times', () => {
  const doses = dosesOn(med, '2026-11-15', 'Asia/Kolkata');
  assert.deepEqual(
    doses.map((d) => d.key),
    ['m1_2026-11-15_0800', 'm1_2026-11-15_2000'],
  );
  assert.equal(doses[1].scheduledAt, '2026-11-15T14:30:00.000Z');
});

test('supply status works out days left and low stock', () => {
  assert.deepEqual(supplyStatus(med), {
    count: 20,
    perDose: 1,
    lowAtDays: 5,
    daysLeft: 10,
    low: false,
  });
  assert.equal(supplyStatus({ ...med, stock: { count: 9, perDose: 1, lowAtDays: 5 } }).low, true);
  assert.equal(dosesPerDay({ ...med, schedule: { ...med.schedule, days: [1, 4] } }), (2 * 2) / 7);
  assert.equal(supplyStatus({ id: 'x' }), null);
});

test('Google Calendar and Maps links are well-formed', () => {
  const url = new URL(
    googleCalendarUrl({
      title: 'Eye check-up',
      startMs: Date.parse('2026-11-20T05:00:00Z'),
      endMs: Date.parse('2026-11-20T05:30:00Z'),
      location: 'Apollo, Hyderabad',
    }),
  );
  assert.equal(url.hostname, 'calendar.google.com');
  assert.equal(url.searchParams.get('dates'), '20261120T050000Z/20261120T053000Z');
  assert.equal(url.searchParams.get('text'), 'Eye check-up');
  assert.match(
    googleMapsDirectionsUrl('Apollo Hospital, Jubilee Hills'),
    /destination=Apollo\+Hospital%2C\+Jubilee\+Hills/,
  );
});
