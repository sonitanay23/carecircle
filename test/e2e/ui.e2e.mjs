/**
 * Browser tests (Playwright), at phone size: an elder and a family member
 * using CareCircle, with accessibility checks on every screen.
 * Run: npm run test:e2e   (needs `npx playwright install chromium` once)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startE2eServer, seen } from './server.mjs';

let app;
let browser;
const shots = process.env.E2E_SCREENSHOTS;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

before(async () => {
  app = await startE2eServer(8090);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise((r) => app.server.close(r));
});

/** Taps a bottom-navigation tab. */
const tab = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
/** Taps one of the big choice buttons ("Evening 8 pm", "After food"). */
const choose = (page, text) => page.locator('label.choice', { hasText: text }).first().click();

const snap = async (page, name) => {
  if (!shots) return;
  await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

/** Basic accessibility checks that run on every screen. */
async function a11yCheck(page, where) {
  const problems = await page.evaluate(() => {
    const out = [];
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
    document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach((el) => {
      const labelled = el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!labelled) out.push(`unlabelled ${el.tagName} name=${el.name}`);
    });
    document.querySelectorAll('button, a[href]').forEach((el) => {
      if (!name(el) && !el.querySelector('img[alt]:not([alt=""])')) out.push(`nameless ${el.tagName}`);
    });
    document.querySelectorAll('img').forEach((el) => {
      if (!el.hasAttribute('alt')) out.push('img without alt');
    });
    if (document.querySelectorAll('h1').length !== 1) out.push(`h1 count ${document.querySelectorAll('h1').length}`);
    if (!document.documentElement.lang) out.push('no lang');
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) out.push(`duplicate ids ${dup.join(',')}`);
    // Touch targets at least 44px tall (visible ones).
    document.querySelectorAll('.button, .tile, .choice > span, .site-nav a').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height && r.width && r.height < 44) out.push(`small target "${name(el).slice(0, 20)}" ${Math.round(r.height)}px`);
    });
    // Nothing wider than the screen (no sideways scrolling).
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`horizontal scroll ${document.documentElement.scrollWidth}px`);
    return out;
  });
  assert.deepEqual(problems, [], `accessibility problems on ${where}`);
}

async function createCircle(page, { name, email, passcode }) {
  await page.goto(`${app.url}/`);
  await page.getByRole('link', { name: /I'm new here/ }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Your email').fill(email);
  await page.getByLabel('Choose a passcode').fill(passcode);
  await page.getByRole('button', { name: 'Create my CareCircle' }).click();
  await page.getByRole('heading', { level: 1, name: new RegExp(name.split(' ')[0]) }).waitFor();
}

test('elder signs up, adds a medicine with big time buttons, and takes it from Today', async () => {
  const ctx = await browser.newContext({ ...PHONE, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${app.url}/`);
  await page.getByRole('heading', { name: 'Welcome to CareCircle' }).waitFor();
  await a11yCheck(page, 'welcome');
  await snap(page, '01-welcome');

  await page.getByRole('link', { name: /I'm new here/ }).click();
  await a11yCheck(page, 'create');
  await snap(page, '02-create');
  await page.getByLabel('Your name').fill('Kamala Devi');
  await page.getByLabel('Your email').fill('kamala@example.com');
  await page.getByLabel('Choose a passcode').fill('mango-tree-42');
  await page.getByRole('button', { name: 'Create my CareCircle' }).click();
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening), Kamala/ }).waitFor();
  await page.getByRole('heading', { name: 'No medicines added yet' }).waitFor();
  await a11yCheck(page, 'today-empty');

  await page.getByRole('link', { name: 'Add medicines' }).click();
  await page.getByRole('button', { name: /Add by hand/ }).click();
  await page.getByLabel('Medicine name').fill('Metformin');
  await page.getByLabel('Strength (optional)').fill('500 mg');
  // Morning is pre-ticked; add Evening, choose After food.
  await choose(page, 'Evening');
  await choose(page, 'After food');
  await page.getByText('A different time').click();
  await page.getByRole('button', { name: 'Add a time' }).click();
  await page.getByLabel('Time', { exact: true }).fill('00:01');
  await page.getByText('More details (optional)').click();
  await page.getByLabel('How many tablets do you have now?').fill('30');
  await a11yCheck(page, 'add-medicine');
  await snap(page, '03-add-medicine');
  await page.getByRole('button', { name: 'Save medicine' }).click();
  await page.getByRole('heading', { name: 'Metformin 500 mg' }).waitFor();
  await page.getByText('After food').first().waitFor();
  await a11yCheck(page, 'medicines');
  await snap(page, '04-medicines');

  await tab(page, 'Today');
  await page.getByText('0 of 3 taken today').waitFor();
  await a11yCheck(page, 'today');
  await snap(page, '05-today');
  // The hero shows the dose that needs attention, with one big button.
  await page.getByRole('button', { name: "I've taken it" }).click();
  await page.getByText('1 of 3 taken today').waitFor();
  await page.locator('.pill-done').first().waitFor();

  await page.getByRole('button', { name: 'Ask a question' }).click();
  await page.getByLabel('Your question').fill('When is my next medicine?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByText('Your next medicine is at 8 in the evening.').waitFor();
  await page.getByRole('button', { name: 'Close' }).click();

  assert.deepEqual(errors, []);
  await ctx.close();
});

test('prescription scan: a big phone photo is shrunk, read, checked and added', async () => {
  const ctx = await browser.newContext({ ...PHONE, timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  await createCircle(page, { name: 'Gopal Rao', email: 'gopal@example.com', passcode: 'tall-tree-48' });
  await tab(page, 'Medicines');

  // A 3000x4000 photo, the size a phone camera makes.
  const photo = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 4000;
    const g = c.getContext('2d');
    g.fillStyle = '#fdfcf7';
    g.fillRect(0, 0, 3000, 4000);
    g.fillStyle = '#123';
    g.font = '120px serif';
    g.fillText('Tab. Atorvastatin 10 mg  0-0-1  x 30 days', 100, 600);
    for (let i = 0; i < 4000; i += 3) g.fillRect((i * 7919) % 3000, (i * 104729) % 4000, 2, 2); // noise so it stays large
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  assert.ok(photo.length > 100_000, 'test photo is big');
  await page.locator('#scan-input').setInputFiles({ name: 'prescription.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  await page.getByRole('heading', { name: 'We found 1 medicine' }).waitFor();
  assert.equal(seen.lastImage.mimeType, 'image/jpeg', 'converted to JPEG before upload');
  assert.ok(seen.lastImage.bytes < photo.length && seen.lastImage.bytes < 1_500_000, `upload shrunk from ${photo.length} to ${seen.lastImage.bytes} bytes`);
  await page.getByText('Please check this one carefully').waitFor();
  await a11yCheck(page, 'scan-results');
  assert.doesNotMatch(await page.locator('main').innerText(), /^0$/m, 'no stray "0" when there are no warnings');
  await snap(page, '06-scan-results');

  await page.getByRole('button', { name: 'Check and add' }).click();
  assert.equal(await page.getByLabel('Medicine name').inputValue(), 'Atorvastatin');
  assert.equal(await page.getByRole('checkbox', { name: /Bedtime/ }).isChecked(), true, '0-0-1 at night became Bedtime');
  assert.equal(await page.getByRole('checkbox', { name: /Morning/ }).isChecked(), false);
  assert.equal(await page.getByRole('radio', { name: 'After food' }).isChecked(), true, 'food instruction pre-selected');
  await page.getByRole('button', { name: 'Save medicine' }).click();
  await page.getByText('Atorvastatin 10 mg added.').waitFor();
  // The list updates underneath without losing the scan results.
  await page.getByRole('heading', { name: 'Your medicines (1)' }).waitFor();
  await page.getByRole('heading', { name: 'We found 1 medicine' }).waitFor();
  await ctx.close();
});

test('family suggests a change; the elder approves it', async () => {
  const elderCtx = await browser.newContext({ ...PHONE, timezoneId: 'Asia/Kolkata' });
  const elder = await elderCtx.newPage();
  await createCircle(elder, { name: 'Ravi Kumar', email: 'ravi@example.com', passcode: 'blue-river-58' });
  await tab(elder, 'More');
  await a11yCheck(elder, 'more');
  await snap(elder, '07-more');
  await elder.getByRole('link', { name: /Family & settings/ }).click();
  await elder.getByLabel('Their name').fill('Priya');
  await elder.getByRole('button', { name: 'Create invite' }).click();
  const codes = elder.getByRole('dialog').locator('p.code strong');
  const profileCode = (await codes.nth(0).textContent()).trim();
  const inviteCode = (await codes.nth(1).textContent()).trim();
  await elder.getByRole('button', { name: 'Done' }).click();
  await a11yCheck(elder, 'circle');

  const famCtx = await browser.newContext({ ...PHONE, timezoneId: 'America/Los_Angeles' });
  const fam = await famCtx.newPage();
  await fam.goto(`${app.url}/join?profile=${profileCode}`);
  await fam.getByRole('heading', { name: 'Join a CareCircle' }).waitFor();
  assert.equal(await fam.getByLabel('CareCircle code').inputValue(), profileCode, 'invite link pre-fills the code');
  await fam.getByLabel('Invite code').fill(inviteCode);
  await fam.getByLabel('Your email').fill('priya@example.com');
  await fam.getByLabel('Choose a passcode').fill('priya-secret-9');
  await fam.getByRole('button', { name: 'Join' }).click();
  await fam.getByRole('heading', { name: "Ravi's medicines today" }).waitFor();

  await tab(fam, 'Medicines');
  await fam.getByText('Changes you make are sent to Ravi to approve.').waitFor();
  await fam.getByRole('button', { name: /Add by hand/ }).click();
  await fam.getByLabel('Medicine name').fill('Amlodipine');
  await fam.getByLabel('Strength (optional)').fill('5 mg');
  await fam.getByRole('button', { name: 'Save medicine' }).click();
  await fam.getByText(/sent for approval/).first().waitFor();

  await tab(elder, 'Today');
  await elder.getByRole('link', { name: /suggested 1 change/ }).click();
  await elder.locator('.change').getByText('Priya suggested: add Amlodipine 5 mg (08:00)').waitFor();
  await snap(elder, '08-approval');
  await elder.getByRole('button', { name: '✓ Yes, approve' }).click();
  await elder.getByText(/approved Priya's change/).waitFor();

  await fam.reload();
  await fam.getByRole('heading', { name: 'Amlodipine 5 mg' }).waitFor();
  await elderCtx.close();
  await famCtx.close();
});

test('visits, health readings, medical ID QR and the Help button', async () => {
  const ctx = await browser.newContext({ ...PHONE, timezoneId: 'Asia/Kolkata', permissions: ['geolocation'], geolocation: { latitude: 17.385, longitude: 78.4867, accuracy: 20 } });
  const page = await ctx.newPage();
  await createCircle(page, { name: 'Lakshmi Iyer', email: 'lakshmi@example.com', passcode: 'green-leaf-73' });

  await tab(page, 'Visits');
  await page.getByRole('button', { name: /Add a doctor visit/ }).click();
  await page.getByLabel('What is the visit for?').fill('Heart check-up');
  await page.getByLabel('Date').fill(new Date(Date.now() + 3 * 86_400_000).toLocaleDateString('en-CA'));
  await page.getByRole('textbox', { name: 'Time', exact: true }).fill('10:30');
  await page.getByLabel('Doctor (optional)').fill('Dr Rao');
  await page.getByLabel('Address (optional)').fill('Jubilee Hills, Hyderabad');
  await page.getByRole('button', { name: 'Save visit' }).click();
  const cal = page.getByRole('link', { name: /Add to Google Calendar/ });
  await cal.waitFor();
  assert.match(await cal.getAttribute('href'), /^https:\/\/calendar\.google\.com/);
  assert.equal(await cal.getAttribute('rel'), 'noopener noreferrer');
  await a11yCheck(page, 'visits');
  await snap(page, '09-visits');
  await page.getByRole('button', { name: 'Prepare for this visit' }).click();
  await page.getByText('Is my blood pressure OK?').waitFor();
  await page.getByRole('button', { name: 'Close' }).click();

  await tab(page, 'More');
  await page.getByRole('link', { name: /Health readings/ }).click();
  for (const [s, d] of [['128', '84'], ['152', '96']]) {
    await page.getByLabel('Upper number (systolic)').fill(s);
    await page.getByLabel('Lower number (diastolic)').fill(d);
    await page.getByRole('button', { name: 'Save reading' }).click();
    await page.getByText(`${s}/${d} mmHg`).first().waitFor();
  }
  await page.locator('svg.chart polyline').first().waitFor();
  await a11yCheck(page, 'health');
  await snap(page, '10-health');

  await tab(page, 'More');
  await page.getByRole('link', { name: /Medical ID/ }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Blood group').selectOption('O+');
  await page.getByLabel('Allergies (one per line)').fill('Penicillin');
  await page.getByLabel('Name', { exact: true }).fill('Arjun');
  await page.getByLabel('Relation').fill('Son');
  await page.getByLabel('Phone').fill('+919876543210');
  await page.getByRole('button', { name: 'Save medical ID' }).click();
  await page.getByText('Penicillin').first().waitFor();
  await page.getByRole('button', { name: 'Turn on the emergency link' }).click();
  const qr = page.getByRole('img', { name: 'QR code that opens the medical ID' });
  await qr.waitFor({ state: 'visible' });
  const link = (await page.locator('p.code').last().textContent()).trim();
  await page.evaluate(() => document.getElementById('toasts').replaceChildren());
  if (shots) await qr.screenshot({ path: `${shots}/qr.png` });
  await a11yCheck(page, 'medical-id');
  await snap(page, '11-medical-id');

  const anon = await browser.newContext(PHONE);
  const pub = await anon.newPage();
  await pub.goto(link.replace(/^https?:\/\/[^/]+/, app.url));
  await pub.getByRole('heading', { name: 'Lakshmi Iyer' }).waitFor();
  await pub.getByRole('link', { name: 'Call +919876543210' }).waitFor();
  await snap(pub, '12-public-id');
  await anon.close();

  await page.getByRole('button', { name: 'Help' }).click();
  await snap(page, '13-help');
  await page.getByRole('button', { name: 'Send alert to family' }).click();
  await page.getByRole('heading', { name: 'Alert not sent' }).waitFor();
  await page.getByRole('dialog').getByText(/call your local emergency number/).waitFor();
  await page.getByRole('button', { name: 'OK' }).click();
  await ctx.close();
});

test('text size and high contrast stay on after reload; keyboard users can skip to content', async () => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await createCircle(page, { name: 'Test Elder', email: 't@example.com', passcode: 'quiet-hill-27' });
  await tab(page, 'More');
  await page.getByRole('button', { name: 'Extra large' }).click();
  await page.getByRole('button', { name: 'High contrast' }).click();
  await page.reload();
  await page.getByRole('heading', { name: 'More' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.className), 'text-xl contrast-high');
  assert.equal(await page.getByRole('button', { name: 'Extra large' }).getAttribute('aria-pressed'), 'true');
  await a11yCheck(page, 'more-xl-contrast');
  await tab(page, 'Today');
  await snap(page, '14-xl-contrast');

  await page.reload();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to main content');
  await ctx.close();
});
