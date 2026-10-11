/**
 * Turn the script, the measured voice-over and the captured hotspots into one timeline
 * the stage can seek to by time. Scene length follows the narration, so a longer line
 * simply holds its screen longer and nothing ever has to be re-timed by hand.
 *
 * The video is 1080×1920 and shows nothing but the application: the phone screen is scaled
 * until it fills the frame edge to edge, which crops it vertically, so every scene has to say
 * which part of the screen it is looking at. Captions and step chips are drawn on top.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const scenes = read('script/scenes.json');
const { provider, durations } = read('audio/vo/durations.json');
const hotspots = read('shots/hotspots.json');

/** Regions that are not a single element, so the capture run could not record them. */
const REGIONS = {
  '09-card:card-top': { x: 12, y: 138, w: 366, h: 218 },
};

const SCREEN = { w: 390, h: 844 };          // the captured phone viewport, in CSS pixels
const CANVAS = { w: 1080, h: 1920 };        // what the viewer gets, full-bleed
const FILL = CANVAS.w / SCREEN.w;           // scale at which the app spans the whole width
const WINDOW = CANVAS.h / FILL;             // how much of the screen's height that shows
const MAX_ZOOM = 1.0;                       // never past full-bleed: cropping sideways cuts off Hebrew
const BAND = 0.62;                          // share of the frame the focus band should fill
const LEAD = 0.55;                          // breath before the voice starts
const TAIL = 0.85;                          // and after it ends
const CAPTION_CHARS = 38;                   // longest caption line before it has to break

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const rectFor = (shot, key, pad = 0) => {
  const r = hotspots[shot]?.[key] ?? REGIONS[`${shot}:${key}`];
  if (!r) throw new Error(`no hotspot "${key}" on ${shot}`);
  return { x: r.x, y: r.y - pad, w: r.w, h: r.h + pad * 2 };   // pad vertically: phones are narrow
};

/** Smallest rectangle holding all of them. */
const union = (rs) => {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};

/**
 * Where the camera sits: a scale, and the top-left corner of the screen region on show.
 * `s` never drops below FILL, so a letterbox can never appear down the sides.
 */
function view(s, cx, cy) {
  const w = CANVAS.w / s, h = CANVAS.h / s;
  return {
    s: Math.round(s * 10000) / 10000,
    x: Math.round(clamp(cx - w / 2, 0, Math.max(0, SCREEN.w - w)) * 10) / 10,
    y: Math.round(clamp(cy - h / 2, 0, Math.max(0, SCREEN.h - h)) * 10) / 10,
  };
}

/** The establishing shot: the top of the screen, full width, before the camera moves down. */
const wideOn = () => view(FILL, SCREEN.w / 2, WINDOW / 2);

/**
 * The close-up. The app stays full width — a phone screen cropped sideways loses the ends of
 * every Hebrew line — so "closer" means panning down the screen to the part being talked about,
 * with the pointer ring doing the work that a zoom would otherwise do.
 */
const closeOn = (band) => view(
  clamp((CANVAS.h * BAND) / band.h, FILL, FILL * MAX_ZOOM),
  band.x + band.w / 2,
  band.y + band.h / 2,
);

/**
 * Break a spoken line into caption-sized pieces and spread them over the time it takes to
 * say it. Length stands in for duration, which is close enough that captions never lag the
 * voice by more than a syllable.
 */
function captions(say, start, dur) {
  const parts = say.match(/[^,.!?]+[,.!?]*\s*/g) ?? [say];
  const lines = [];
  for (const raw of parts) {
    const piece = raw.trim();
    if (!piece) continue;
    const last = lines[lines.length - 1];
    if (last && `${last} ${piece}`.length <= CAPTION_CHARS) lines[lines.length - 1] = `${last} ${piece}`;
    else lines.push(piece);
  }
  const chars = lines.reduce((a, l) => a + l.length, 0) || 1;
  let t = start;
  return lines.map((text) => {
    const d = (dur * text.length) / chars;
    const line = { text, at: Math.round(t * 1000) / 1000, dur: Math.round(d * 1000) / 1000 };
    t += d;
    return line;
  });
}

let t = 0;
const out = [];
for (const s of scenes) {
  const vo = durations[s.id];
  if (vo == null) throw new Error(`no narration for ${s.id}`);
  const [lead, tail] = s.pad ?? [LEAD, TAIL];
  const dur = Math.round((lead + vo + tail) * 1000) / 1000;

  const scene = { ...s, start: Math.round(t * 1000) / 1000, dur, voStart: lead, voDur: vo };
  delete scene.pad;
  delete scene.bullets;      // the side panel is gone; the captions carry the words now
  scene.captions = captions(s.say, lead, vo);

  if (s.kind === 'screen') {
    const pad = (s.focusPad ?? 0) / 2;
    const band = (s.taps ?? []).length > 1
      ? union(s.taps.map((tap) => rectFor(s.shot, tap.spot, pad)))
      : s.focus ? rectFor(s.shot, s.focus, pad) : null;

    scene.wide = wideOn();
    scene.close = band ? closeOn(band) : scene.wide;
    scene.highlight = band && !s.taps && band.h < WINDOW * 0.8 ? band : null;
    scene.taps = (s.taps ?? []).map((tap) => {
      const r = rectFor(s.shot, tap.spot);
      return { at: lead + tap.at, x: r.x + r.w / 2, y: r.y + r.h / 2 };
    });
  }
  out.push(scene);
  t += dur;
}

const timeline = {
  provider, fps: 30, width: CANVAS.w, height: CANVAS.h,
  screen: SCREEN, total: Math.round(t * 1000) / 1000, scenes: out,
};
writeFileSync(resolve(ROOT, 'studio/timeline.json'), JSON.stringify(timeline, null, 2));
console.log(`${out.length} scenes, ${timeline.total.toFixed(1)}s, ${Math.ceil(timeline.total * 30)} frames`);
for (const s of out.filter((x) => x.kind === 'screen')) {
  console.log(`  ${s.id} ${s.shot.padEnd(17)} wide ${s.wide.s.toFixed(2)}@${s.wide.y}  close ${s.close.s.toFixed(2)}@${s.close.y}  ${s.captions.length} captions`);
}
