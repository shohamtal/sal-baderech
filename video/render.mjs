/**
 * Render the stage to frames, deterministically: the page draws whatever `__render(t)` is
 * given, so a frame depends on nothing but its timestamp and can be re-rendered at will.
 *
 *   node video/render.mjs            # every frame
 *   node video/render.mjs --at 12.5  # one still, for checking a shot
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('/private/tmp/claude-501/-Users-shohamtal-repos2-sal-baderech/8c1a5895-082f-41f4-9de6-fff7c9559768/scratchpad/tools/');
const puppeteer = require('puppeteer');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const FRAMES = resolve(ROOT, 'out/frames');
const timeline = JSON.parse(readFileSync(resolve(ROOT, 'studio/timeline.json'), 'utf8'));

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const stills = arg('--at')?.split(',').map(Number) ?? null;
const from = Number(arg('--from') ?? 0);
const to = Number(arg('--to') ?? timeline.total);

async function main() {
  const browser = await puppeteer.launch({
    headless: 'shell',
    args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: timeline.width, height: timeline.height, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(pathToFileURL(resolve(ROOT, 'studio/stage.html')).href, { waitUntil: 'networkidle0' });
  await page.evaluate(
    (tl, base) => window.__init(tl, base),
    timeline,
    pathToFileURL(resolve(ROOT, 'shots')).href,
  );
  await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });

  if (stills) {
    mkdirSync(resolve(ROOT, 'out/stills'), { recursive: true });
    for (const t of stills) {
      await page.evaluate((x) => window.__render(x), t);
      const f = resolve(ROOT, `out/stills/t${t.toFixed(2)}.png`);
      await page.screenshot({ path: f });
      console.log(f);
    }
    await browser.close();
    return;
  }

  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const total = Math.round((to - from) * timeline.fps);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.__render(t), from + i / timeline.fps);
    await page.screenshot({ path: resolve(FRAMES, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
    if (i % 250 === 0 || i === total - 1) {
      const done = (i + 1) / total;
      const eta = ((Date.now() - started) / done) * (1 - done) / 1000;
      console.log(`  ${i + 1}/${total}  ${(done * 100).toFixed(1)}%  eta ${eta.toFixed(0)}s`);
    }
  }
  writeFileSync(resolve(ROOT, 'out/frames.json'), JSON.stringify({ frames: total, fps: timeline.fps, from }));
  await browser.close();
  console.log(`\n${total} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
