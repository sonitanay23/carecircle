/**
 * Google Calendar and Google Maps links. These use public URL formats, so they
 * work without any sign-in or API key and open the user's own Google apps.
 */

const calendarStamp = (ms) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

export function googleCalendarUrl({ title, startMs, endMs, details, location }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${calendarStamp(startMs)}/${calendarStamp(endMs)}`,
  });
  if (details) params.set('details', details);
  if (location) params.set('location', location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export const googleMapsSearchUrl = (query) =>
  `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`;

export const googleMapsDirectionsUrl = (destination) =>
  `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination })}`;
