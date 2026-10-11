/**
 * Generate the instrumental bed with Meta MusicGen on Replicate (~$0.05 a run).
 * The result is cached at video/audio/music.mp3; delete that file to regenerate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const OUT = resolve(ROOT, 'audio/music.mp3');
if (existsSync(OUT)) { console.log('cached:', OUT); process.exit(0); }

const ENV_FILES = [
  resolve(process.env.HOME, '.claude/.env'),
  resolve(process.env.HOME, '.claude/skills/music-generator/scripts/.env'),
];
const fromEnvFiles = (key) => ENV_FILES
  .filter(existsSync)
  .map((f) => readFileSync(f, 'utf8').match(new RegExp(`${key}="?([^"\n]+)"?`))?.[1])
  .find(Boolean);
const token = process.env.REPLICATE_API_TOKEN ?? fromEnvFiles('REPLICATE_API_TOKEN');
if (!token) throw new Error('no REPLICATE_API_TOKEN');

const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const PROMPT = 'warm uplifting corporate background music, gentle acoustic guitar arpeggio, '
  + 'soft felt piano, light string pad, subtle hand percussion, hopeful and calm, '
  + 'instrumental, no vocals, steady 92 bpm, clean modern production';

const model = await (await fetch('https://api.replicate.com/v1/models/meta/musicgen', { headers: H })).json();
const start = await (await fetch('https://api.replicate.com/v1/predictions', {
  method: 'POST', headers: H,
  body: JSON.stringify({
    version: model.latest_version.id,
    input: { prompt: PROMPT, duration: 120, model_version: 'stereo-melody-large', output_format: 'mp3', temperature: 0.9 },
  }),
})).json();
if (!start.id) throw new Error(JSON.stringify(start));
console.log('prediction', start.id);

for (;;) {
  await new Promise((r) => setTimeout(r, 8000));
  const p = await (await fetch(`https://api.replicate.com/v1/predictions/${start.id}`, { headers: H })).json();
  process.stdout.write(`\r${p.status}        `);
  if (p.status === 'succeeded') {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, Buffer.from(await (await fetch(p.output)).arrayBuffer()));
    console.log(`\nwrote ${OUT}`);
    break;
  }
  if (p.status === 'failed' || p.status === 'canceled') throw new Error(p.error ?? p.status);
}
