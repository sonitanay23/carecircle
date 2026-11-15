/** Display preferences kept on this device: text size and high contrast. */
const KEY = 'carecircle.display';
export const TEXT_SIZES = [
  { value: 'normal', label: 'Normal', className: null },
  { value: 'large', label: 'Large', className: 'text-large' },
  { value: 'xl', label: 'Extra large', className: 'text-xl' },
];

export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY)) ?? {};
    // Older versions stored { large: true }.
    if (p.large === true && !p.size) p.size = 'large';
    return p;
  } catch {
    return {};
  }
}

export function applyPrefs(p) {
  const root = document.documentElement;
  for (const s of TEXT_SIZES)
    if (s.className) root.classList.toggle(s.className, p.size === s.value);
  root.classList.toggle('contrast-high', Boolean(p.contrast));
}

export function savePrefs(patch) {
  const p = { ...loadPrefs(), ...patch };
  delete p.large;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  applyPrefs(p);
  return p;
}
