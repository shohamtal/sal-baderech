# סרטון הדרכה למתנדב חדש

A 2:47 Hebrew tutorial for the volunteer flow, shot **vertical (1080×1920)** so it plays full
screen on a phone. Every screen in it is a screenshot of the running application, captured by
driving the local dev stack with a browser — nothing is a mockup.

The frame holds the app and nothing else: no device bezel, no desk, no side panel. The step chip
and the captions are drawn on top of it, deliberately styled as an overlay so nobody mistakes them
for part of the product.

```
video/
  script/scenes.json     the narration and what each scene points at — edit this first
  capture.mjs            drives the app in a 390×844 browser, writes shots/ + hotspots.json
  narrate.mjs            one WAV per line, and the durations the timeline needs
  music.mjs              the instrumental bed (Replicate MusicGen, cached in audio/music.mp3)
  build-timeline.mjs     script + durations + hotspots  →  studio/timeline.json
  studio/stage.html      the 1920×1080 stage; __render(t) draws any instant
  render.mjs             screenshots every frame of the stage
  mux.mjs                mixes the soundtrack and encodes the mp4
  demo-seed.sql          extra demo recipients, local stack only — never run in production
```

## Rebuilding it

```bash
npx supabase start -x studio,imgproxy,logflare,vector,supavisor   # local DB
docker exec -i supabase_db_sal-baderech psql -U postgres -d postgres -q < video/demo-seed.sql
npm run dev                                                       # :5173

node video/capture.mjs        # ~1 min   screens + the rectangles to point at
node video/narrate.mjs        # ~20 s    Hebrew voice-over
node video/music.mjs          # ~3 min   skipped if audio/music.mp3 exists
node video/build-timeline.mjs
node video/render.mjs         # ~4 min   5000 frames
node video/mux.mjs            # ~30 s
```

`node video/render.mjs --at 61,103` writes single stills to `out/stills/`, which is much faster than
a full pass when you are adjusting framing or text. `--from 57.4 --to 66` renders a short preview
cut instead of the whole film; `mux.mjs` notices and writes `out/preview.mp4`.

## How the pictures are made

Nothing is pre-rendered into the HTML: `__render(t)` is a pure function of time, so a frame depends
only on its timestamp and the whole video can be re-rendered or re-timed at will.

Close-ups move the **whole device**, not the picture inside it. Cropping a full-width button to zoom
in makes it look broken; a phone that grows past the edge of the frame simply reads as a close-up.
The zoom comes from the height of the focus band, and overlay rings and outlines are divided by the
zoom so they stay the same size on screen.

Scene length follows the narration — each scene is its spoken line plus a breath at either end — so
rewriting a sentence re-times the video automatically and nothing has to be adjusted by hand.

## One demo identity

Every screen uses the same obviously-fake details: **ישראל ישראלי** and **050-123-4567**. The
volunteer who registers on camera is typed in by `capture.mjs`; every recipient phone number is
forced to the same value by `demo-seed.sql`. Recipient *names* stay distinct, because they are
different households and a task list of twenty identical names looks broken.

A viewer who sees a different name or number on each screen starts wondering whether they are
still looking at the same person, and a number that looks real has no business being in something
handed out to volunteers.

## The voice

The draft uses macOS `say` with **Carmit**, the only Hebrew voice macOS ships, pitched down into a
male register. macOS has no male Hebrew voice at all, so this is an approximation, not the real
thing. Four things decide whether it sounds like speech or like a broken tape, and all four were
got wrong on the first pass:

- **Ask `say` for 48 kHz.** Its default is 22.05 kHz; pitching *that* down and stretching it back
  up was where most of the warble came from.
- **Shift gently.** Every semitone of `asetrate` costs a matching `atempo` stretch, and `atempo`
  is what smears consonants. 0.86 sounds far better than 0.80 and is barely less male.
- **Normalise once, in two passes.** Measure, then apply a flat gain. Single-pass `loudnorm` rides
  the level as it plays, and `mux.mjs` used to run a *second* one over the finished mix.
- **Do not scale an `amix` bus you already told not to average.** `normalize=0` means "sum";
  multiplying by the input count on top of that put every line twenty-one times too loud and
  clipped it into the intermediate WAV. That one was audible as harsh distortion on the voice.

The finished mix sits at about −16 dB RMS with −1 dB of peak headroom, because AAC reconstructs
slightly above the PCM peak and a mix that touches full scale comes back clipped.

## The paid voice

**Only `eleven_v3` speaks Hebrew.** `eleven_multilingual_v2`, `eleven_turbo_v2_5` and
`eleven_flash_v2_5` all reject `language_code: "he"` with a 400 — ask the API rather than guessing,
it answers in one request. The default voice is Daniel (`onwK4e9ZLuTAKqWW03F9`); override with
`ELEVENLABS_VOICE_ID`, and the whole script regenerates because the voice is part of the cache key.

```bash
node video/narrate.mjs --provider elevenlabs      # only what changed
node video/narrate.mjs --provider elevenlabs --only s11,s12
node video/narrate.mjs --provider elevenlabs --force
node video/build-timeline.mjs && node video/render.mjs && node video/mux.mjs
```

**Each line is its own file and its own request.** `audio/vo/manifest.json` records a fingerprint
of everything a line was made from — text, model, voice, settings — so a second run regenerates
nothing and fixing one sentence costs one sentence. That matters at a tenth of a cent per
character and a 10,000-character budget; the whole script is about 1,600.

There is **nothing to stitch back together**. `mux.mjs` already places each file at its own
timestamp with `adelay`, exactly as it does for the free voice, so "split into sections" is not a
change to the pipeline — it is what the pipeline already was. The only thing that had to be added
was the cache.

Older models accept `previous_text` / `next_text`, which carry intonation across a cut so that a
split script does not sound like twenty-one separate recordings. **v3 rejects both.** That turns
out to be the better bargain: with no cross-line context, a line depends on nothing but its own
text, so one edit can never invalidate its neighbours. `CONTEXT` in `narrate.mjs` tracks which
behaviour is in force and the cache key follows it.

Hebrew came back from the API correct — a Whisper round-trip of the generated audio reproduced the
source text exactly, including `ווייז` spoken as Waze.

Each run also writes a `-share.mp4`, bitrate-targeted to land under 15 MB whatever the runtime.
The full-quality file is ~64 MB, which WhatsApp will not take.

## Inside the app

The clip is also the in-app tutorial, offered on the volunteer screen
(`src/pages/volunteer/OrgHome.tsx`) through `src/components/TutorialVideo.tsx`:
a button in the header on every state, plus a card in the page body for volunteers who have not
been approved yet — that is who has never seen the app. Once a volunteer is working, the card goes
away and the task list gets the space back.

It is a plain static asset under `public/learn/`, so GitHub Pages serves it with range requests and
nothing else has to exist. Two things keep it from costing every visitor:

- the `<video>` element is not rendered until somebody opens the player, so the file is only
  fetched on demand. All a normal session pays for is the 18 KB poster.
- `workbox.globPatterns` in `vite.config.ts` lists no `mp4`, so the service worker never precaches
  fourteen megabytes. Do not add one.

Regenerate both after a re-render:

```bash
ffmpeg -y -i video/out/sal-baderech-tutorial-final.mp4 \
  -c:v libx264 -preset veryslow -crf 30 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 96k -ar 48000 -ac 2 public/learn/tutorial.mp4
ffmpeg -y -ss 1.6 -i video/out/sal-baderech-tutorial-final.mp4 \
  -frames:v 1 -vf scale=540:-2 -q:v 4 public/learn/tutorial.jpg
```

CRF 30 rather than the 28 tried first: the hardest frame in the film is the map, and at 1080×1920
it survives 30 cleanly while the file drops from 19 MB to 14.5. `+faststart` is what lets the
browser start playing from a range request instead of downloading the whole thing.
