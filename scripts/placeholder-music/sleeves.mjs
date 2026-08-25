// sleeves.mjs — nine sleeve treatments. Each album picks one in catalog.mjs and is
// painted around a single hue derived from its own title, so the art is stable
// across regenerations and no two albums hand the accent extractor the same colour.
//
// Every painter ends the same way — grain, then vignette, then the type block —
// because those three are what stop a generated field from reading as a CSS
// gradient screenshotted at 640px.
import { canvas, hsl, hash, rng, text, textWidth, SIZE } from './art.mjs';

/** The palette one album is painted from: a committed hue, a complement far enough
 *  away to read as a second colour, and an ink that survives on both. */
function palette(seed) {
  const rand = rng(seed);
  const h = rand();
  const dark = rand() < 0.62;
  return {
    rand,
    hue: h,
    alt: (h + 0.36 + rand() * 0.22) % 1,
    dark,
    ground: dark ? hsl(h, 0.34 + rand() * 0.2, 0.09 + rand() * 0.06)
                 : hsl(h, 0.22 + rand() * 0.14, 0.86 - rand() * 0.08),
    ink: dark ? hsl(h, 0.10, 0.93) : hsl(h, 0.55, 0.14),
    bold: hsl(h, 0.72 + rand() * 0.18, dark ? 0.52 : 0.46),
    second: hsl((h + 0.36) % 1, 0.66, dark ? 0.56 : 0.44),
    /* The artist line sits on the type PLATE, not on the artwork, so it cannot
       reuse `bold`: a mid-lightness accent on a light plate (or on a dark one) is
       the one place the first cut of these sleeves went unreadable. Pinned to the
       far side of the plate's lightness instead. */
    label: dark ? hsl(h, 0.80, 0.70) : hsl(h, 0.85, 0.32),
  };
}

/** The type block every sleeve carries: artist above, album below, in the 5×7 face.
 *  Long titles are cut to the sleeve's width rather than scaled to illegibility —
 *  the same choice a real sleeve makes. */
function typeBlock(cv, p, artist, album) {
  const pad = 46;
  const aScale = 3;
  let tScale = 6;
  const words = String(album).toUpperCase().split(' ');
  // Wrap the title into at most three lines, shrinking until it fits.
  let lines = [];
  while (tScale >= 3) {
    lines = [];
    let cur = '';
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (textWidth(trial, tScale) > SIZE - pad * 2 && cur) { lines.push(cur); cur = w; } else cur = trial;
    }
    if (cur) lines.push(cur);
    if (lines.length <= 3) break;
    tScale--;
  }
  lines = lines.slice(0, 3);

  const blockH = lines.length * (7 * tScale + Math.round(3.5 * tScale));
  const top = SIZE - pad - blockH - 7 * aScale - 18;

  // A soft plate behind the type — on a busy field, letterforms alone disappear.
  // Faded in from the top rather than a hard band, so it reads as printed onto the
  // sleeve instead of as a UI bar laid over it.
  const plateTop = top - 30;
  const plate = p.dark ? [0, 0, 0] : [255, 255, 255];
  for (let y = plateTop; y < SIZE; y++) {
    const t = Math.min(1, (y - plateTop) / 46);
    cv.rect(0, y, SIZE, 1, plate, 0.62 * t * t);
  }

  text(cv, artist, pad, top, aScale, p.label, 1, 2);
  let y = top + 7 * aScale + 18;
  for (const l of lines) {
    text(cv, l, pad, y, tScale, p.ink, 1, 1);
    y += 7 * tScale + Math.round(3.5 * tScale);
  }
}

const finish = (cv, p, album) => {
  cv.grain(p.dark ? 16 : 13, p.rand);
  cv.vignette(p.dark ? 0.42 : 0.22);
  typeBlock(cv, p, album.albumartist, album.title);
  return cv;
};

/* ── the nine ──────────────────────────────────────────────────────────────── */

const STYLES = {
  /** Concentric rings off a centre pushed off-axis — a record, abstracted. */
  rings(cv, p) {
    cv.fill(() => p.ground);
    const cx = SIZE * (0.3 + p.rand() * 0.4), cy = SIZE * (0.28 + p.rand() * 0.3);
    const n = 14 + Math.floor(p.rand() * 12);
    for (let i = n; i > 0; i--) {
      const r = (i / n) * SIZE * 0.62;
      cv.ring(cx, cy, r, 3 + p.rand() * 9, i % 3 === 0 ? p.second : p.bold, 0.14 + (1 - i / n) * 0.5);
    }
    cv.disc(cx, cy, 16, p.ink, 0.9);
  },

  /** A saturated bloom over a dark field — the loudest thing in the grid. */
  bloom(cv, p) {
    cv.fill(() => p.ground);
    const cx = SIZE * (0.35 + p.rand() * 0.3), cy = SIZE * (0.3 + p.rand() * 0.2);
    for (let r = SIZE * 0.55; r > 4; r *= 0.88) {
      cv.disc(cx, cy, r, r > SIZE * 0.3 ? p.second : p.bold, 0.16, 40);
    }
    for (let i = 0; i < 5; i++) {
      cv.disc(SIZE * p.rand(), SIZE * p.rand(), 20 + p.rand() * 90, p.bold, 0.09, 30);
    }
  },

  /** A landscape: a bright band above a heavy one, with a sun on the seam. */
  horizon(cv, p) {
    const y0 = SIZE * (0.42 + p.rand() * 0.16);
    const sky = hsl(p.hue, 0.5, p.dark ? 0.3 : 0.66);
    const land = hsl((p.hue + 0.5) % 1, 0.4, p.dark ? 0.08 : 0.24);
    cv.fill((x, y) => {
      if (y < y0) {
        const t = y / y0;
        return [sky[0] + (p.ground[0] - sky[0]) * t * 0.7,
                sky[1] + (p.ground[1] - sky[1]) * t * 0.7,
                sky[2] + (p.ground[2] - sky[2]) * t * 0.7].map(Math.round);
      }
      const t = (y - y0) / (SIZE - y0);
      return land.map((c) => Math.round(c * (1 - t * 0.55)));
    });
    cv.disc(SIZE * (0.24 + p.rand() * 0.5), y0 - SIZE * (0.05 + p.rand() * 0.12), SIZE * 0.13, p.bold, 0.92, 3);
    for (let i = 0; i < 7; i++) {
      const yy = y0 + 12 + i * (SIZE - y0) / 8;
      cv.rect(0, yy, SIZE, 1 + p.rand() * 2, p.bold, 0.16);
    }
  },

  /** Soft horizontal washes — the ambient/instrumental treatment. */
  wash(cv, p) {
    cv.fill((x, y) => {
      const t = y / SIZE;
      const a = hsl(p.hue, 0.4, p.dark ? 0.12 : 0.8);
      const b = hsl(p.alt, 0.45, p.dark ? 0.34 : 0.58);
      const w = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.3 + x * 0.0016);
      return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w].map(Math.round);
    });
    for (let i = 0; i < 26; i++) {
      const y = SIZE * p.rand();
      cv.rect(0, y, SIZE, 2 + p.rand() * 26, i % 2 ? p.bold : p.second, 0.05 + p.rand() * 0.07);
    }
  },

  /** Hard diagonal bars. Reads as punk/indie at thumbnail size. */
  stripes(cv, p) {
    cv.fill(() => p.ground);
    const w = 26 + p.rand() * 34, slope = 0.5 + p.rand() * 1.4;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const band = Math.floor((x + y * slope) / w);
        if (band % 3 === 0) cv.px(x, y, p.bold, 0.9);
        else if (band % 3 === 1) cv.px(x, y, p.second, 0.35);
      }
    }
  },

  /** A modular grid of blocks — the reissue/box-set look. */
  grid(cv, p) {
    cv.fill(() => p.ground);
    const n = 5 + Math.floor(p.rand() * 4), cell = SIZE / n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const v = p.rand();
      if (v < 0.34) continue;
      const col = v < 0.68 ? p.bold : p.second;
      const inset = cell * (0.04 + p.rand() * 0.14);
      if (p.rand() < 0.24) cv.disc(c * cell + cell / 2, r * cell + cell / 2, cell / 2 - inset, col, 0.55 + p.rand() * 0.4);
      else cv.rect(c * cell + inset, r * cell + inset, cell - inset * 2, cell - inset * 2, col, 0.4 + p.rand() * 0.5);
    }
  },

  /** Rays from a corner — the live-record/energy treatment. */
  burst(cv, p) {
    cv.fill(() => p.ground);
    const cx = SIZE * (p.rand() < 0.5 ? 0.16 : 0.84), cy = SIZE * (0.2 + p.rand() * 0.3);
    const rays = 16 + Math.floor(p.rand() * 20);
    for (let i = 0; i < rays; i++) {
      const a0 = (i / rays) * Math.PI * 2, spread = (Math.PI * 2) / rays * (0.3 + p.rand() * 0.5);
      const col = i % 2 ? p.bold : p.second;
      for (let r = 0; r < SIZE * 1.1; r += 1) {
        const th = a0 + spread * 0.5;
        cv.px(Math.round(cx + Math.cos(th) * r), Math.round(cy + Math.sin(th) * r), col, 0.5 * (1 - r / (SIZE * 1.2)));
        for (let k = -Math.round(r * spread * 0.5); k <= r * spread * 0.5; k++) {
          const th2 = a0 + spread * 0.5 + k / Math.max(r, 1);
          cv.px(Math.round(cx + Math.cos(th2) * r), Math.round(cy + Math.sin(th2) * r), col, 0.45 * (1 - r / (SIZE * 1.2)));
        }
      }
    }
    cv.disc(cx, cy, 30 + p.rand() * 40, p.ink, 0.8);
  },

  /** A duotone split down an off-centre axis — the folk/singer-songwriter look. */
  split(cv, p) {
    const a = hsl(p.hue, 0.44, p.dark ? 0.16 : 0.78);
    const b = hsl(p.alt, 0.5, p.dark ? 0.38 : 0.4);
    const cut = SIZE * (0.34 + p.rand() * 0.32), tilt = (p.rand() - 0.5) * 0.5;
    cv.fill((x, y) => (x + (y - SIZE / 2) * tilt < cut ? a : b));
    // A stack of thin rules across the seam, like a printed spine.
    for (let i = 0; i < 30; i++) {
      const y = SIZE * p.rand();
      const w = 40 + p.rand() * 200;
      cv.rect(cut - w / 2 + (y - SIZE / 2) * -tilt, y, w, 1 + p.rand() * 3, p.bold, 0.25 + p.rand() * 0.4);
    }
  },

  /** A halo of overlapping soft discs — the jazz/downtempo treatment. */
  halo(cv, p) {
    cv.fill((x, y) => {
      const t = (x / SIZE + y / SIZE) / 2;
      return p.ground.map((c, i) => Math.round(c * (0.82 + 0.3 * t) + (p.bold[i] - c) * 0.06 * t));
    });
    const cx = SIZE * (0.42 + p.rand() * 0.16), cy = SIZE * (0.34 + p.rand() * 0.14);
    for (let i = 0; i < 9; i++) {
      const ang = p.rand() * Math.PI * 2, d = SIZE * (0.02 + p.rand() * 0.17);
      cv.disc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, SIZE * (0.13 + p.rand() * 0.18),
              i % 2 ? p.bold : p.second, 0.2, 26);
    }
    cv.ring(cx, cy, SIZE * 0.29, 2.5, p.ink, 0.5);
  },
};

export const STYLE_NAMES = Object.keys(STYLES);

/** Paint one album's sleeve. Deterministic in (albumartist, title). */
export function sleeve(album) {
  const p = palette(hash(`${album.albumartist} — ${album.title}`));
  const cv = canvas();
  (STYLES[album.art] || STYLES.rings)(cv, p);
  return finish(cv, p, album);
}
