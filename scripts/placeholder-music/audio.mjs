// audio.mjs — the placeholder audio itself, synthesised by ffmpeg from an expression
// this file writes. No samples, no downloads, nothing anyone else owns.
//
// Why synthesise at all rather than ship 260 copies of one silent file: a music
// client is judged on things silence cannot show you. The progress bar has to
// advance over a real duration, the waveform/seek has to land somewhere, the mini
// player has to keep playing across a route change, and gapless-ish album order has
// to sound like an album rather than 260 identical beeps. Each ALBUM gets its own
// key, tempo, chord progression and instrumentation; each TRACK varies within it.
//
// ⚠️ The expression is passed as ONE argv element to `-f lavfi -i`, and a
// filtergraph splits filters on `,` — which every `mod(t,x)` in here contains. It
// is wrapped in single quotes for that reason, not for the shell's benefit: this
// spawns ffmpeg directly with an argv array and there is no shell involved.
import { rng } from './art.mjs';

/** Sample rate. 22.05 kHz is plenty for tones and halves the expression evaluations,
 *  which is the whole cost of generating a four-minute track. */
export const SR = 22050;

/* ── what each genre sounds like ───────────────────────────────────────────────
   `pluck` decides the envelope (a plucked note vs. a bar-long pad swell), the drum
   levels decide whether there is a kit at all, and `drive` is the tanh saturation
   that separates a clean folk record from a metal one. */
const PROFILES = {
  shoegaze:   { bpm: [96, 116],  root: [110, 165], mode: 'minor', pluck: 0.0, decay: 1.2, drive: 3.4, kick: 0.30, hat: 0.10, snare: 0.16, noise: 0.055, bass: 0.30, lowpass: 3600, dur: [200, 400] },
  postrock:   { bpm: [72, 92],   root: [98, 147],  mode: 'minor', pluck: 0.7, decay: 2.2, drive: 1.5, kick: 0.22, hat: 0.07, snare: 0.10, noise: 0.012, bass: 0.34, lowpass: 5200, dur: [240, 520] },
  indie:      { bpm: [112, 138], root: [131, 196], mode: 'major', pluck: 1.0, decay: 4.5, drive: 1.8, kick: 0.34, hat: 0.13, snare: 0.20, noise: 0.010, bass: 0.32, lowpass: 6400, dur: [150, 260] },
  folk:       { bpm: [76, 100],  root: [147, 220], mode: 'major', pluck: 1.0, decay: 3.2, drive: 1.0, kick: 0.00, hat: 0.04, snare: 0.00, noise: 0.008, bass: 0.20, lowpass: 6800, dur: [140, 260] },
  alt:        { bpm: [104, 132], root: [110, 165], mode: 'minor', pluck: 0.9, decay: 3.6, drive: 2.4, kick: 0.36, hat: 0.12, snare: 0.22, noise: 0.014, bass: 0.36, lowpass: 5600, dur: [170, 300] },
  electronic: { bpm: [120, 140], root: [82, 131],  mode: 'minor', pluck: 1.0, decay: 7.0, drive: 2.0, kick: 0.44, hat: 0.18, snare: 0.16, noise: 0.010, bass: 0.40, lowpass: 7200, dur: [200, 420] },
  ambient:    { bpm: [52, 68],   root: [73, 110],  mode: 'minor', pluck: 0.0, decay: 0.8, drive: 1.0, kick: 0.00, hat: 0.00, snare: 0.00, noise: 0.030, bass: 0.24, lowpass: 2600, dur: [260, 620] },
  punk:       { bpm: [160, 192], root: [110, 165], mode: 'major', pluck: 0.9, decay: 5.5, drive: 4.2, kick: 0.42, hat: 0.20, snare: 0.30, noise: 0.020, bass: 0.38, lowpass: 6000, dur: [95, 175] },
  downtempo:  { bpm: [84, 100],  root: [87, 131],  mode: 'minor', pluck: 0.6, decay: 3.0, drive: 1.4, kick: 0.32, hat: 0.14, snare: 0.14, noise: 0.016, bass: 0.36, lowpass: 4200, dur: [220, 400] },
  classical:  { bpm: [58, 84],   root: [131, 262], mode: 'major', pluck: 0.4, decay: 1.6, drive: 1.0, kick: 0.00, hat: 0.00, snare: 0.00, noise: 0.006, bass: 0.18, lowpass: 7600, dur: [160, 420] },
  jazz:       { bpm: [96, 132],  root: [98, 175],  mode: 'dorian', pluck: 0.8, decay: 3.4, drive: 1.2, kick: 0.16, hat: 0.16, snare: 0.10, noise: 0.020, bass: 0.34, lowpass: 6200, dur: [200, 460] },
  metal:      { bpm: [128, 168], root: [73, 110],  mode: 'minor', pluck: 0.9, decay: 6.0, drive: 6.5, kick: 0.46, hat: 0.16, snare: 0.30, noise: 0.018, bass: 0.42, lowpass: 5000, dur: [190, 400] },
  americana:  { bpm: [88, 112],  root: [131, 196], mode: 'major', pluck: 1.0, decay: 3.0, drive: 1.2, kick: 0.20, hat: 0.09, snare: 0.14, noise: 0.010, bass: 0.28, lowpass: 6600, dur: [160, 280] },
  pop:        { bpm: [100, 126], root: [147, 220], mode: 'major', pluck: 1.0, decay: 4.8, drive: 1.9, kick: 0.38, hat: 0.16, snare: 0.24, noise: 0.008, bass: 0.34, lowpass: 7000, dur: [155, 250] },
};

export const SOUND_NAMES = Object.keys(PROFILES);
export const profileOf = (sound) => PROFILES[sound] || PROFILES.indie;

/** Chord degrees (semitones from the key root) each mode moves between. */
const PROGRESSIONS = {
  major:  [[0, 7, 9, 5], [0, 5, 7, 7], [0, 9, 5, 7], [0, 4, 5, 7]],
  minor:  [[0, 8, 3, 5], [0, 5, 3, 10], [0, 3, 7, 5], [0, 10, 8, 7]],
  dorian: [[0, 5, 10, 3], [0, 3, 5, 10], [0, 7, 5, 2]],
};

/** The voices stacked on each chord root, as semitone offsets. */
const VOICINGS = {
  major:  [0, 4, 7, 12],
  minor:  [0, 3, 7, 12],
  dorian: [0, 3, 7, 10],
};

const f = (n) => Number(n.toFixed(4));

/**
 * One album's musical identity — key, tempo, progression — so its tracks belong
 * together. Deterministic in the album seed.
 */
export function albumVoice(seed, sound) {
  const p = profileOf(sound);
  const rand = rng(seed);
  const progs = PROGRESSIONS[p.mode];
  return {
    profile: p,
    root: p.root[0] + rand() * (p.root[1] - p.root[0]),
    bpm: p.bpm[0] + rand() * (p.bpm[1] - p.bpm[0]),
    prog: progs[Math.floor(rand() * progs.length)],
    voicing: VOICINGS[p.mode],
  };
}

/**
 * The aevalsrc expression for one track. Everything is inlined as a literal so
 * ffmpeg evaluates arithmetic, never lookups.
 */
export function trackExpression(voice, seed, duration) {
  const { profile: p } = voice;
  const rand = rng(seed);

  // Per-track variation inside the album's identity: transpose a little, nudge the
  // tempo, and rotate the progression so two tracks never open on the same bar.
  const semis = [-4, -2, 0, 0, 2, 3, 5, 7][Math.floor(rand() * 8)];
  const root = voice.root * Math.pow(2, semis / 12);
  const bpm = voice.bpm * (0.94 + rand() * 0.12);
  const rot = Math.floor(rand() * voice.prog.length);
  const prog = [...voice.prog.slice(rot), ...voice.prog.slice(0, rot)];

  const beat = 60 / bpm;
  const bar = beat * 4;
  const sub = [1, 2, 2, 4][Math.floor(rand() * 4)];
  const note = beat / sub;

  // The bar's chord root, chosen by a nested if over precomputed frequencies —
  // ffmpeg's expression language has no arrays, and a nested if of four literals
  // costs less than any encoding of one.
  const freqs = prog.map((d) => f(root * Math.pow(2, d / 12)));
  let chord = String(freqs[freqs.length - 1]);
  for (let i = freqs.length - 2; i >= 0; i--) chord = `if(eq(ld(0),${i}),${freqs[i]},${chord})`;

  const parts = [];
  parts.push(`st(0,mod(trunc(t/${f(bar)}),${prog.length}))`);
  parts.push(`st(1,${chord})`);

  // Voices. `pluck` crossfades between a plucked envelope (retriggered every note)
  // and a bar-long swell that reaches zero at the bar line — which is what keeps a
  // pad from clicking when the chord underneath it changes.
  const env = p.pluck >= 0.999
    ? `exp(-${f(p.decay)}*mod(t,${f(note)}))`
    : p.pluck <= 0.001
      ? `(0.5-0.5*cos(2*PI*mod(t,${f(bar)})/${f(bar)}))`
      : `(${f(p.pluck)}*exp(-${f(p.decay)}*mod(t,${f(note)}))+${f(1 - p.pluck)}*(0.5-0.5*cos(2*PI*mod(t,${f(bar)})/${f(bar)})))`;
  parts.push(`st(2,${env})`);

  const voices = voice.voicing.map((iv, i) => {
    const k = f(Math.pow(2, iv / 12));
    const amp = f(0.30 / (1 + i * 0.55));
    // A few cents of detune per voice — perfectly tuned sines beat against each
    // other into something that sounds broken rather than rich.
    const det = f(1 + (rand() - 0.5) * 0.006);
    return `${amp}*sin(2*PI*ld(1)*${f(k * det)}*t)`;
  }).join('+');
  parts.push(`st(3,(${voices})*ld(2))`);

  // Bass on the bar root, an octave down, with its own slower decay.
  parts.push(`st(4,${f(p.bass)}*sin(2*PI*ld(1)*0.5*t)*exp(-${f(Math.max(1.2, p.decay * 0.35))}*mod(t,${f(beat * 2)})))`);

  const drums = [];
  if (p.kick > 0) drums.push(`${f(p.kick)}*sin(2*PI*54*t)*exp(-13*mod(t,${f(beat)}))`);
  if (p.snare > 0) drums.push(`${f(p.snare)}*(random(0)*2-1)*exp(-19*mod(t+${f(beat)},${f(beat * 2)}))`);
  if (p.hat > 0) drums.push(`${f(p.hat)}*(random(1)*2-1)*exp(-55*mod(t+${f(beat / 2)},${f(beat)}))`);
  if (p.noise > 0) drums.push(`${f(p.noise)}*(random(2)*2-1)`);
  parts.push(`st(5,${drums.length ? drums.join('+') : '0'})`);

  // Saturate, then normalise the saturation back so a heavy `drive` reads as
  // distortion rather than as "this record is much louder than the last one".
  const drive = f(p.drive);
  const norm = f(1 / Math.tanh(drive * 0.75));
  const fadeIn = f(Math.min(2.5, duration * 0.02));
  const fadeOut = f(Math.min(4.0, duration * 0.05));

  parts.push(
    `0.82*${norm}*tanh(${drive}*(ld(3)+ld(4)+ld(5)))` +
    `*min(1,t/${fadeIn})*min(1,(${f(duration)}-t)/${fadeOut})`
  );

  return parts.join(';');
}

/** A track's length in seconds — genre-shaped, with the odd interlude and the odd
 *  long one, because a library where every track is 3:30 does not stress a track list. */
export function trackDuration(seed, sound) {
  const p = profileOf(sound);
  const rand = rng(seed);
  const r = rand();
  if (r < 0.07) return Math.round(p.dur[0] * (0.32 + rand() * 0.22));          // interlude
  if (r > 0.93) return Math.round(p.dur[1] * (1.0 + rand() * 0.5));            // the long one
  return Math.round(p.dur[0] + rand() * (p.dur[1] - p.dur[0]));
}

/** The full ffmpeg argv for one track: synth → filter → mp3 with embedded art + tags. */
export function ffmpegArgs({ expression, duration, lowpass, coverPath, tags, out, bitrate = '32k' }) {
  const meta = [];
  for (const [k, v] of Object.entries(tags)) {
    if (v === null || v === undefined || v === '') continue;
    meta.push('-metadata', `${k}=${v}`);
  }
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', `aevalsrc='${expression}':s=${SR}:d=${duration}`,
    '-i', coverPath,
    // A gentle high-pass keeps the sub-bass out of the mp3's bit budget at 32k, and
    // the genre low-pass is most of what makes an ambient record sound unlike a punk one.
    '-af', `highpass=f=38,lowpass=f=${lowpass},alimiter=limit=0.94`,
    '-map', '0:a', '-map', '1:v',
    '-c:a', 'libmp3lame', '-b:a', bitrate, '-ac', '1',
    '-c:v', 'mjpeg', '-vf', 'scale=500:500',
    '-id3v2_version', '3', '-write_id3v1', '1',
    '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)',
    ...meta,
    '-y', out,
  ];
}
