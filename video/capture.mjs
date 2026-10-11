/**
 * Capture the volunteer journey from the local dev stack as phone-sized stills.
 *
 * Each still is paired with the on-screen rectangles the tutorial needs to point at,
 * so the studio renderer can draw a tap ring exactly where a finger would land.
 * Run with: node video/capture.mjs   (needs `npm run dev` + the local Supabase stack)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/private/tmp/claude-501/-Users-shohamtal-repos2-sal-baderech/8c1a5895-082f-41f4-9de6-fff7c9559768/scratchpad/tools/');
const puppeteer = require('puppeteer');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const SHOTS = resolve(ROOT, 'shots');
const ORG = 'חסד-לדוגמה';
/** One demo identity for the whole video; see the note in demo-seed.sql. */
const DEMO = { name: 'ישראל ישראלי', phone: '050-123-4567' };
const BASE = 'http://localhost:5173/#/' + encodeURIComponent(ORG) + '/home';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', 'supabase_db_sal-baderech', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();

const manifest = {};

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'shell',
    args: ['--lang=he-IL', '--force-device-scale-factor=4', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 4, isMobile: true, hasTouch: true });
  await page.emulateTimezone('Asia/Jerusalem');

  /** Find the first clickable element containing this text. */
  const findByText = async (text) =>
    (await page.evaluateHandle(
      (t) => [...document.querySelectorAll('button,a,summary,label,[role=button]')]
        .find((e) => e.textContent.trim().includes(t)) ?? null,
      text,
    )).asElement();

  /** The card (rounded panel) that contains this text — what a finger actually taps. */
  const findCard = async (text) =>
    (await page.evaluateHandle(
      (t) => [...document.querySelectorAll('.rounded-2xl')]
        .find((e) => e.textContent.trim().includes(t)) ?? null,
      text,
    )).asElement();

  /**
   * Targets are written as `css:<selector>`, `card:<text>` or plain text, so a Hebrew
   * label never reaches querySelector and blows up as an invalid selector.
   */
  const resolve1 = async (target) => {
    if (typeof target !== 'string') return target;
    if (target.startsWith('css:')) return page.$(target.slice(4));
    if (target.startsWith('card:')) return findCard(target.slice(5));
    if (target.startsWith('modal:')) {
      const t = target.slice(6);
      return (await page.evaluateHandle((t) => {
        const modal = [...document.querySelectorAll('div')].find((d) => String(d.className).includes('z-[1000]'));
        return modal ? [...modal.querySelectorAll('button,select,input,textarea')]
          .find((e) => (e.textContent.trim() + e.tagName).includes(t)) ?? null : null;
      }, t)).asElement();
    }
    return findByText(target);
  };

  const rectOf = async (el) => {
    const b = await el.boundingBox();
    return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
  };

  async function shot(name, hotspots = {}) {
    await sleep(350);
    const spots = {};
    for (const [key, target] of Object.entries(hotspots)) {
      const el = await resolve1(target);
      if (!el) { console.warn(`  ! no element for ${name}.${key}`); continue; }
      const r = await rectOf(el);
      if (r) spots[key] = r;
    }
    await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
    manifest[name] = spots;
    console.log(`  ✓ ${name}`, Object.keys(spots).join(', '));
  }

  console.log('register');
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[autocomplete="name"]', { timeout: 20000 });
  await shot('01-register', { name: 'css:input[autocomplete="name"]', phone: 'css:input[type="tel"]', submit: 'שליחת בקשה' });

  await page.type('input[autocomplete="name"]', DEMO.name, { delay: 20 });
  await page.type('input[type="tel"]', DEMO.phone, { delay: 20 });
  await shot('02-register-filled', {
    name: 'css:input[autocomplete="name"]', phone: 'css:input[type="tel"]', submit: 'שליחת בקשה',
  });

  (await findByText('שליחת בקשה')).click();
  await page.waitForFunction(() => document.body.innerText.includes('ההרשמה נקלטה'), { timeout: 20000 });
  await shot('03-pending', { recheck: 'בדיקה מחדש' });

  console.log('approve the volunteer the way a coordinator would');
  psql(`update public.campaign_volunteers set status = 'APPROVED', approved_at = now()
        where id = (select id from public.campaign_volunteers order by created_at desc limit 1);`);

  (await findByText('בדיקה מחדש')).click();
  await page.waitForFunction(() => document.body.innerText.includes('בחירת כתובות'), { timeout: 20000 });
  await shot('04-approved', { pickTab: 'בחירת כתובות', tasksTab: 'המשימות שלי' });

  console.log('pick');
  (await findByText('בחירת כתובות')).click();
  await page.waitForFunction(() => document.body.innerText.includes('כמה סלים'), { timeout: 20000 });
  await sleep(600);
  const five = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '5'));
  await shot('05-pick-count', { five: five.asElement(), counts: 'css:.grid-cols-5' });

  await five.asElement().click();
  await page.waitForFunction(() => document.body.innerText.includes('הצעות למקבץ'), { timeout: 20000 });
  await sleep(3500); // let the map tiles land
  await shot('06-suggestions', { first: 'card:הצעה 1', second: 'card:הצעה 2', map: 'css:.leaflet-container' });

  await page.evaluate(() => document.querySelector('.leaflet-container')
    ?.scrollIntoView({ block: 'center' }));
  await sleep(2500);
  await shot('06b-map', { map: 'css:.leaflet-container' });

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }));
  await sleep(1200);
  await shot('07-claim', { claim: 'לוקח את המקבץ' });

  (await findByText('לוקח את המקבץ')).click();
  await page.waitForFunction(() => document.body.innerText.includes('נמסרו'), { timeout: 20000 });
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await sleep(900);
  await shot('08-tasks', { counter: 'css:.text-3xl', card: 'css:main .rounded-2xl' });

  await page.evaluate(() => window.scrollTo({ top: 120 }));
  await sleep(600);
  await shot('09-card', { waze: 'ניווט עם Waze', delivered: '✅ נמסר', failed: 'לא הצלחתי למסור', fix: 'דיווח תיקון' });

  console.log('modals');
  (await findByText('לא הצלחתי למסור')).click();
  await sleep(800);
  await shot('10-undeliverable', { reason: 'modal:SELECT', send: 'modal:דיווח' });
  await page.click('button[aria-label="סגור"]');
  await sleep(600);

  (await findByText('דיווח תיקון')).click();
  await sleep(800);
  await shot('11-correction', { field: 'modal:SELECT', send: 'modal:שליחת בקשה' });
  await page.click('button[aria-label="סגור"]');
  await sleep(600);

  console.log('delivered');
  await page.evaluate(() => window.scrollTo({ top: 120 }));
  const deliveredBtn = await findByText('✅ נמסר');
  await deliveredBtn.click();
  await sleep(2500);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await sleep(800);
  await shot('12-delivered', { counter: 'css:.text-3xl' });

  const mapTab = await findByText('מפה');
  if (mapTab) {
    await mapTab.click();
    await sleep(3000);
    await shot('13-tasks-map', { map: 'css:.leaflet-container' });
  }

  writeFileSync(resolve(SHOTS, 'hotspots.json'), JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log('\nwrote', Object.keys(manifest).length, 'shots');
}

main().catch((e) => { console.error(e); process.exit(1); });
