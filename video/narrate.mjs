/**
 * Render the Hebrew voice-over, one WAV per scene, plus the durations the timeline needs.
 *
 *   node video/narrate.mjs            # free: macOS "Carmit", pitched down into a male register
 *   node video/narrate.mjs --provider elevenlabs
 *
 * macOS ships no male Hebrew voice, so the free pass takes the one Hebrew voice there is and
 * drops it a few semitones with asetrate, compensating the tempo so the timing is untouched.
 * Three things keep that from sounding like a broken tape:
 *
 *   - `say` is asked for 48 kHz directly. Its default is 22.05 kHz, and resampling *that* down
 *     and stretching it back up is where most of the warble came from.
 *   - the shift is mild. Each semitone of asetrate costs a matching atempo stretch, and atempo
 *     is what smears consonants.
 *   - loudness is matched in two passes, measuring first and then applying a flat gain. Single
 *     pass loudnorm rides the level as it goes, which pumps — and mux.mjs used to run a second
 *     one over the finished mix, so every line was being ridden twice.
 *
 * It is still a stand-in for a real voice, not a replacement.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const OUT = resolve(ROOT, 'audio/vo');
const scenes = JSON.parse(readFileSync(resolve(ROOT, 'script/scenes.json'), 'utf8'));
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? null : process.argv[i + 1];
};
const provider = arg('--provider') ?? 'say';
const only = arg('--only')?.split(',').map((x) => x.trim());
const force = process.argv.includes('--force');

/**
 * Every line is its own file and its own request, and a manifest remembers what each one was
 * made from. Re-running only regenerates what actually changed, so fixing one sentence costs
 * one sentence — which matters when the provider bills by the character.
 *
 * There is nothing to stitch back together afterwards: mux.mjs places each file at its own
 * timestamp on the timeline, exactly as it already does for the free voice.
 */
const MANIFEST = resolve(ROOT, 'audio/vo/manifest.json');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const duration = (f) =>
  parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim());

/** Pitch down by PITCH and re-stretch to the original length, then master lightly for speech. */
const PITCH = 0.86;
const SR = 48000;
const COLOUR = [
  `asetrate=${Math.round(SR * PITCH)}`,
  'aresample=48000:filter_size=128:cutoff=0.95',  // this ffmpeg has no soxr; tighten swr instead
  `atempo=${(1 / PITCH).toFixed(4)}`,
  'highpass=f=70',
  'equalizer=f=140:t=q:w=1.0:g=3',          // chest, to sell the lower register
  'equalizer=f=7200:t=q:w=1.0:g=-3',        // tame the sibilance the stretch exaggerates
  'acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160:makeup=2',
].join(',');

const TARGET = 'I=-16:TP=-1.5:LRA=11';

/**
 * Match loudness in two passes. The first only measures; the second applies a constant gain,
 * so nothing moves while the line plays.
 */
function normalise(file) {
  // loudnorm prints its measurements on stderr, along with everything else ffmpeg says.
  const log = spawnSync('ffmpeg',
    ['-i', file, '-af', `loudnorm=${TARGET}:print_format=json`, '-f', 'null', '-'],
    { encoding: 'utf8' },
  ).stderr;
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}`
    + `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
  const tmp = `${file}.norm.wav`;
  sh('ffmpeg', ['-y', '-v', 'error', '-i', file,
    '-af', `loudnorm=${TARGET}:${measured}:linear=true`, '-ar', '48000', '-ac', '1', tmp]);
  sh('mv', [tmp, file]);
}

function sayVoice(text, rate, out) {
  const raw = `${out}.raw.wav`;
  sh('say', ['-v', 'Carmit', '-r', String(rate),
    '--file-format=WAVE', `--data-format=LEI16@${SR}`, '-o', raw, text]);
  sh('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', COLOUR, '-ar', '48000', '-ac', '1', out]);
  sh('rm', ['-f', raw]);
  normalise(out);
}

/**
 * ElevenLabs. Only `eleven_v3` speaks Hebrew — the others reject `language_code: "he"` outright,
 * which the API will tell you if you ask it.
 *
 * Older models take the lines either side as `previous_text` / `next_text` to carry intonation
 * across a cut; v3 rejects both outright, so with v3 every line is generated in isolation. That
 * is the better bargain here anyway: a line depends on nothing but its own text, so editing one
 * sentence regenerates exactly one sentence. CONTEXT tracks which behaviour is in force, and the
 * cache key follows it.
 */
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'onwK4e9ZLuTAKqWW03F9';   // Daniel, steady broadcaster
const MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_v3';
const SETTINGS = { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true };
const CONTEXT = MODEL !== 'eleven_v3';     // v3: "previous_text ... is not yet supported"

function elevenKey() {
  const files = [
    resolve(process.env.HOME, '.claude/.env'),
    resolve(process.env.HOME, '.claude/skills/music-generator/scripts/.env'),
  ].filter(existsSync);
  const fromFile = (k) => files
    .map((f) => readFileSync(f, 'utf8').match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1])
    .find(Boolean);
  const key = process.env.ELEVENLABS_API_KEY ?? fromFile('ELEVENLABS_API_KEY') ?? fromFile('ELEVEN_LABS_API_KEY');
  if (!key) throw new Error('no ElevenLabs API key');
  return key;
}

async function elevenVoice(text, out, { previous, next }) {
  const body = JSON.stringify({
    text, model_id: MODEL, language_code: 'he',
    previous_text: CONTEXT ? previous ?? undefined : undefined,
    next_text: CONTEXT ? next ?? undefined : undefined,
    voice_settings: SETTINGS,
  });
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': elevenKey(), 'Content-Type': 'application/json' }, body,
    });
    if (res.ok) {
      const mp3 = `${out}.mp3`;
      writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
      sh('ffmpeg', ['-y', '-v', 'error', '-i', mp3, '-ar', '48000', '-ac', '1', out]);
      sh('rm', ['-f', mp3]);
      normalise(out);
      return;
    }
    last = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`ElevenLabs refused "${text.slice(0, 30)}…": ${last}`);
}

/** What this line was made from. Change any of it and the line is regenerated; otherwise it is not. */
const fingerprint = (s, previous, next) => createHash('sha1').update(JSON.stringify(
  provider === 'elevenlabs'
    ? [provider, MODEL, VOICE, SETTINGS, s.say, ...(CONTEXT ? [previous, next] : [])]
    : [provider, PITCH, SR, s.say, s.say_rate ?? 168],
)).digest('hex').slice(0, 12);

mkdirSync(OUT, { recursive: true });
const durations = {};
let made = 0, kept = 0, chars = 0;

for (const [i, s] of scenes.entries()) {
  const out = resolve(OUT, `${s.id}.wav`);
  const previous = scenes[i - 1]?.say ?? null;
  const next = scenes[i + 1]?.say ?? null;
  const want = fingerprint(s, previous, next);

  const stale = force || !existsSync(out) || manifest[s.id]?.hash !== want;
  const wanted = !only || only.includes(s.id);

  if (stale && wanted) {
    if (provider === 'elevenlabs') await elevenVoice(s.say, out, { previous, next });
    else sayVoice(s.say, s.say_rate ?? 168, out);
    manifest[s.id] = { hash: want, chars: s.say.length, at: new Date().toISOString() };
    made += 1;
    chars += s.say.length;
  } else {
    if (stale) console.log(`${s.id}  skipped by --only, but its text has changed`);
    kept += 1;
  }
  if (!existsSync(out)) throw new Error(`${s.id} has no audio and was not generated`);

  durations[s.id] = Math.round(duration(out) * 1000) / 1000;
  console.log(`${s.id}  ${durations[s.id].toFixed(2)}s  ${stale && wanted ? 'new ' : 'kept'}  ${s.say.slice(0, 40)}…`);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
writeFileSync(resolve(OUT, 'durations.json'), JSON.stringify({ provider, durations }, null, 2));
const total = Object.values(durations).reduce((a, b) => a + b, 0);
console.log(`\n${provider}: ${made} generated (${chars} characters), ${kept} reused, ${total.toFixed(1)}s of speech`);
