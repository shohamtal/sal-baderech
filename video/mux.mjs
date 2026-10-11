/**
 * Mix the soundtrack and mux it onto the rendered frames.
 *
 * The music sits under the narration and is ducked by it: the voice-over drives a sidechain
 * compressor, so the bed drops whenever someone is speaking and comes back up in the gaps,
 * without anybody drawing a volume curve by hand.
 *
 * Audio is built to a file first and muxed second. One filter graph that both loops music and
 * pads twenty-one voice tracks is miserable to debug when it stalls; two plain steps are not.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const timeline = JSON.parse(readFileSync(resolve(ROOT, 'studio/timeline.json'), 'utf8'));
const { frames, fps, from = 0 } = JSON.parse(readFileSync(resolve(ROOT, 'out/frames.json'), 'utf8'));
const TOTAL = frames / fps;
const PART = from > 0 || TOTAL < timeline.total - 0.1;   // a preview cut, not the whole film
const out = resolve(ROOT, PART
  ? 'out/preview.mp4'
  : `out/sal-baderech-tutorial-${timeline.provider === 'say' ? 'draft' : 'final'}.mp4`);

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'warning', '-stats', ...args], { stdio: 'inherit' });
const T = TOTAL.toFixed(3);

/* ---- 1. the narration, every line at its own place on the clock ---- */
const voArgs = [];
const voChains = [];
const voLabels = [];
timeline.scenes.forEach((s, i) => {
  const file = resolve(ROOT, `audio/vo/${s.id}.wav`);
  if (!existsSync(file)) throw new Error(`missing narration ${file}`);
  const at = s.start + s.voStart - from;
  if (at + s.voDur < 0 || at > TOTAL) return;            // outside this cut
  voArgs.push('-i', file);
  const k = voLabels.length;
  const head = at < 0 ? `atrim=start=${(-at).toFixed(3)},asetpts=N/SR/TB,` : '';
  const delay = Math.round(Math.max(0, at) * 1000);
  voChains.push(`[${k}:a]aresample=48000,${head}adelay=${delay}|${delay}[v${k}]`);
  voLabels.push(`[v${k}]`);
});
const VO = resolve(ROOT, 'out/vo.wav');
ff([...voArgs, '-filter_complex',
  // normalize=0 already means "sum, don't average", and the lines never overlap. Scaling by the
  // input count on top of that multiplied every line by twenty-one and clipped it into the WAV.
  `${voChains.join(';')};${voLabels.join('')}amix=inputs=${voLabels.length}:normalize=0:dropout_transition=0,apad[a]`,
  '-map', '[a]', '-t', T, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '1', VO]);

/* ---- 2. the bed, looped to length and ducked by the narration ---- */
const BED = resolve(ROOT, 'out/bed.wav');
ff(['-stream_loop', '-1', '-i', resolve(ROOT, 'audio/music.mp3'),
  '-af', `atrim=start=${from.toFixed(3)},asetpts=N/SR/TB,aresample=48000`,
  '-t', T, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', BED]);

const MIX = resolve(ROOT, 'out/mix.wav');
ff(['-i', BED, '-i', VO, '-filter_complex', [
  `[0:a]volume=0.20,afade=t=in:st=0:d=2.5,afade=t=out:st=${Math.max(0, TOTAL - 4).toFixed(2)}:d=4[bed]`,
  '[1:a]volume=1.1,asplit=2[voA][voB]',
  '[bed][voA]sidechaincompress=threshold=0.03:ratio=9:attack=25:release=420:makeup=1[duck]',
  // No loudnorm here: every line was already matched line-by-line in two passes, and a second
  // single-pass normaliser over the finished mix rides the level and makes the voice pump.
  // Leave real headroom. AAC reconstructs slightly above the PCM peak, so a mix that touches
  // full scale comes back clipped on the other side of the encoder.
  // Gain first, limiter last. The other way round the make-up gain lifts peaks back over the
  // ceiling the limiter just set, which is the same as having no limiter at all.
  '[duck][voB]amix=inputs=2:normalize=0,volume=2.5dB,alimiter=limit=0.89:level=disabled[mix]',
].join(';'), '-map', '[mix]', '-t', T, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', MIX]);

/* ---- 3. mux ---- */
ff(['-framerate', String(fps), '-i', resolve(ROOT, 'out/frames/f%05d.jpg'), '-i', MIX,
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', '-r', String(fps),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
  '-t', T, out]);

/* ---- 4. a small cut, because 58 MB will not go through WhatsApp ---- */
if (!PART) {
  const share = out.replace(/\.mp4$/, '-share.mp4');
  // Sized to clear WhatsApp's 16 MB ceiling with room to spare, whatever the runtime.
  const kbps = Math.floor(((14.5 * 8192) / TOTAL) - 112);
  ff(['-i', out, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '30',
    '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '112k', share]);
  console.log(`\n${share}`);
}

console.log(`\n${out}`);
