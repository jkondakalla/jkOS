// art.mjs — generative sleeve art, drawn in pure Node.
//
// Two reasons this is hand-rolled rather than "grab a few JPEGs":
//
// 1. THE ACCENT COMES OFF THE SLEEVE. player/accent.ts derives the whole Now
//    Playing colour scheme from the cover's dominant hue, and its own header
//    records what happens when a sleeve has no dominant hue: every track renders
//    the same dead slate and it reads as "the theme is broken". So each album
//    here is painted around ONE committed hue, which is exactly what makes the
//    glass show its range as you move between albums.
// 2. A placeholder library that ships pictures of real records is a placeholder
//    library that can never be shared, screenshotted or committed.
//
// No dependencies: a PNG is a zlib stream of filtered scanlines plus four CRC'd
// chunks, and Node has zlib and enough arithmetic for the rest.
import zlib from 'node:zlib';

export const SIZE = 640;

/* ── PNG container ─────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGB byte array (w*h*3) as a PNG buffer. */
export function encodePng(rgb, w, h) {
  const stride = w * 3;
  // Filter byte 0 (None) per scanline: the images here are smooth gradients and
  // noise, and paying for adaptive filtering would save bytes nobody is counting.
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy
      ? rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgb.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type 2 = truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── colour + seeded randomness ────────────────────────────────────────────── */

/** Deterministic 32-bit hash of a string — the seed for one album's whole sleeve,
 *  so re-running the generator repaints the identical art. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** h in [0,1), s/l in [0,1] → [r,g,b] 0-255. */
export function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 1) + 1) % 1 * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/* ── the canvas ────────────────────────────────────────────────────────────── */

export function canvas(w = SIZE, h = SIZE) {
  const buf = Buffer.alloc(w * h * 3);
  return {
    w, h, buf,
    /** Blend [r,g,b] over the pixel at x,y with coverage a (0-1). */
    px(x, y, rgb, a = 1) {
      if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
      const i = (y * w + x) * 3;
      if (a >= 1) { buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; return; }
      buf[i] += (rgb[0] - buf[i]) * a;
      buf[i + 1] += (rgb[1] - buf[i + 1]) * a;
      buf[i + 2] += (rgb[2] - buf[i + 2]) * a;
    },
    /** Paint every pixel from f(x,y) → [r,g,b]. */
    fill(f) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.px(x, y, f(x, y));
    },
    rect(x0, y0, rw, rh, rgb, a = 1) {
      for (let y = Math.max(0, y0 | 0); y < Math.min(h, (y0 + rh) | 0); y++)
        for (let x = Math.max(0, x0 | 0); x < Math.min(w, (x0 + rw) | 0); x++) this.px(x, y, rgb, a);
    },
    /** A soft-edged disc — `feather` pixels of falloff, so nothing on a sleeve
     *  has the jagged edge that gives a generated image away at a glance. */
    disc(cx, cy, r, rgb, a = 1, feather = 1.5) {
      const x0 = Math.max(0, Math.floor(cx - r - feather)), x1 = Math.min(w - 1, Math.ceil(cx + r + feather));
      const y0 = Math.max(0, Math.floor(cy - r - feather)), y1 = Math.min(h - 1, Math.ceil(cy + r + feather));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cov = d <= r - feather ? 1 : d >= r + feather ? 0 : (r + feather - d) / (2 * feather);
        if (cov > 0) this.px(x, y, rgb, a * cov);
      }
    },
    ring(cx, cy, r, width, rgb, a = 1) {
      const x0 = Math.max(0, Math.floor(cx - r - width)), x1 = Math.min(w - 1, Math.ceil(cx + r + width));
      const y0 = Math.max(0, Math.floor(cy - r - width)), y1 = Math.min(h - 1, Math.ceil(cy + r + width));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r);
        const cov = Math.max(0, 1 - d / width);
        if (cov > 0) this.px(x, y, rgb, a * cov * cov);
      }
    },
    /** Per-pixel film grain. Sleeves without it read as vector art, and the suite's
     *  whole material language is grained paper and glass over grain. */
    grain(amount, rand) {
      for (let i = 0; i < buf.length; i += 3) {
        const n = (rand() - 0.5) * amount;
        buf[i] = clamp(buf[i] + n); buf[i + 1] = clamp(buf[i + 1] + n); buf[i + 2] = clamp(buf[i + 2] + n);
      }
    },
    /** Darken the corners. One cheap trick that makes a flat field read as a photograph. */
    vignette(strength = 0.35) {
      const cx = w / 2, cy = h / 2, max = Math.hypot(cx, cy);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const f = 1 - strength * Math.pow(Math.hypot(x - cx, y - cy) / max, 2.2);
        const i = (y * w + x) * 3;
        buf[i] *= f; buf[i + 1] *= f; buf[i + 2] *= f;
      }
    },
    png() { return encodePng(buf, w, h); },
  };
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/* ── a 5×7 bitmap face, so a sleeve can carry a word ───────────────────────── */

// A 5×7 face. Each glyph is seven five-bit rows; the module asserts that shape on
// load, because a row one bit long renders as a DIFFERENT LETTER rather than as an
// error — the first cut of this table was uniformly 37 bits wide and every sleeve
// silently printed a slightly wrong alphabet.
const GLYPH_ROWS = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '11100 01000 01000 01000 01000 01000 11100', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  '&': '01100 10010 10100 01000 10101 10010 01101', '.': '00000 00000 00000 00000 00000 01100 01100',
  ',': '00000 00000 00000 00000 01100 01100 01000', '-': '00000 00000 00000 11111 00000 00000 00000',
  '\'': '01100 01100 01000 00000 00000 00000 00000', '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00110 00100 00000 00100', '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000', '/': '00001 00010 00010 00100 01000 01000 10000',
  ':': '00000 01100 01100 00000 01100 01100 00000', ' ': '00000 00000 00000 00000 00000 00000 00000',
};

const GLYPHS = Object.fromEntries(Object.entries(GLYPH_ROWS).map(([k, v]) => {
  const rows = v.split(' ');
  if (rows.length !== 7 || rows.some((r) => r.length !== 5)) {
    throw new Error(`art.mjs: glyph '${k}' is not 7×5 — got ${rows.length} rows of ${rows.map((r) => r.length)}`);
  }
  return [k, rows.join('')];
}));

/** Fold what the catalog actually contains onto what the face can draw: strip
 *  diacritics (É → E), spell out the letters NFD leaves alone (Ø, Æ, ß), and drop
 *  the rest. Without this a title reads `CAF  LECTRIQUE` on its own sleeve. */
const FOLD = { 'Ø': 'O', 'Æ': 'AE', 'Œ': 'OE', 'Ð': 'D', 'Þ': 'TH', 'ß': 'SS', '–': '-', '—': '-', '…': '' };

export function foldToFace(str) {
  return String(str).toUpperCase()
    .replace(/[ØÆŒÐÞß–—…]/g, (c) => FOLD[c] ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9&.,\-'!?():/ ]/g, '')
    .replace(/\s+/g, ' ').trim();
}
/** Draw `text` in the 5×7 face, `scale` pixels per bit, at x,y. Returns its width. */
export function text(cv, str, x, y, scale, rgb, a = 1, tracking = 1) {
  let cx = x;
  for (const ch of foldToFace(str)) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r * 5 + c] === '1') cv.rect(cx + c * scale, y + r * scale, scale, scale, rgb, a);
    }
    cx += (5 + tracking) * scale;
  }
  return cx - x;
}

export function textWidth(str, scale, tracking = 1) {
  return foldToFace(str).length * (5 + tracking) * scale - tracking * scale;
}
