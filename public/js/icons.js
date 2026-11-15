/**
 * Simple line icons (24x24, stroke). Inline SVG renders the same on every
 * phone, unlike emoji. Icons are decorative: the text next to them carries
 * the meaning, so they are hidden from screen readers.
 */
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  sunrise: 'M12 3v3M5.6 7.6l1.4 1.4M18.4 7.6 17 9M3 17h18M7 17a5 5 0 0 1 10 0M8 21h8',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5 3.6 3.6M20.4 20.4 19 19M5 19l-1.4 1.4M20.4 3.6 19 5M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z',
  sunset: 'M12 9V3M8.5 6.5 12 3l3.5 3.5M3 17h18M7 17a5 5 0 0 1 10 0M8 21h8',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7zM8.5 8.5l7 7',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  heart: 'M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-3a4.5 4.5 0 0 1 9 3c-2 4.5-9 9-9 9z',
  id: 'M3 5h18v14H3zM7 15c.5-1.5 1.7-2 3-2s2.5.5 3 2M10 11a1.5 1.5 0 1 0 0-3a1.5 1.5 0 1 0 0 3zM15 9h3M15 12h3',
  people: 'M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M21 19c0-2.4-1.6-4-4-4.5',
  home: 'M3 11 12 4l9 7M5 10v10h14V10',
  check: 'M4 12.5 9.5 18 20 6',
  plus: 'M12 5v14M5 12h14',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7z',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chevron: 'm9 6 6 6-6 6',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18a9 9 0 1 0 0 18z',
  warning: 'M12 4 2.5 20h19zM12 10v4M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18a9 9 0 1 0 0 18zM12 11v6M12 8h.01',
  map: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12a2 2 0 1 0 0-4a2 2 0 1 0 0 4z',
  textsize: 'M4 18 8 7l4 11M5.5 14h5M14 18l3-8 3 8M15 15.5h4',
  contrast: 'M12 21a9 9 0 1 0 0-18zM12 3a9 9 0 1 1 0 18',
  signout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  close: 'M6 6l12 12M18 6 6 18',
  print: 'M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  skip: 'M6 6l12 12M18 6 6 18',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
};

export function icon(name, { size = 24, className = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon ${className}`.trim());
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS.info);
  svg.append(path);
  return svg;
}

/** Part of the day for a "HH:MM" time, used to group doses the way people think about them. */
export function partOfDay(hhmm) {
  const h = Number(hhmm.slice(0, 2));
  if (h < 12) return { key: 'morning', label: 'Morning', icon: 'sunrise' };
  if (h < 17) return { key: 'afternoon', label: 'Afternoon', icon: 'sun' };
  if (h < 21) return { key: 'evening', label: 'Evening', icon: 'sunset' };
  return { key: 'night', label: 'Night', icon: 'moon' };
}
