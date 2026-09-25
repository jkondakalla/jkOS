// vibespace.mjs — the pure math under the vibe space (ALGORITHMS.md §9, M6).
//
// ⚠️ WHY THIS GATE EXISTS. The vibe space draws the whole library as a cloud you swipe
// through a 4th dimension, and almost everything that can be wrong with it still draws
// a beautiful cloud: a packed column decoded one byte out of step puts every track on
// its neighbour's coordinates; a tone map normalised per slice makes the three calm
// tracks of a library blaze as brightly as its thousand loud ones; inferred album
// centroids stacked into the density invent a hot spot the size of an album; a slice
// spacing too coarse for its kernel makes the cloud STEP as you swipe while every still
// frame looks fine. None of these throw. So they are asserted, and continuity (G7) is
// MEASURED on the production settings rather than claimed.
//
// geometry.ts imports @jkos/scene/math; both are transpiled in-memory with the repo's
// own `typescript` (packages/scene/test/transpile.mjs) and the REAL functions are
// driven — the house pattern.
//
// Run:  node test/vibespace.mjs   (wired as `pnpm check:vibespace`, folded into
//                                   `pnpm test:contracts`).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { transpileSceneMath } from '../packages/scene/test/transpile.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-vibespace-'));

process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

async function importTs(relPath, outName, rewrite = {}) {
  let src = readFileSync(resolve(root, relPath), 'utf8');
  for (const [from, to] of Object.entries(rewrite)) {
    src = src.split(`'${from}'`).join(`'${to}'`);
  }
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, isolatedModules: true },
    fileName: relPath,
  });
  const outFile = join(tmp, outName);
  writeFileSync(outFile, outputText);
  return import(pathToFileURL(outFile).href);
}

const GEOMETRY = 'apps/kouros/src/components/vibespace/geometry.ts';
const scene = await import(transpileSceneMath(join(tmp, 'scene')));
const g = await importTs(GEOMETRY, 'geometry.mjs', { '@jkos/scene/math': './scene/index.mjs' });

/* A seeded PRNG, so every fixture below is the same library every run. */
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The server's packing (backend/src/discover/map.js), re-spelled here so the decoder
   cannot be made to pass by sharing a bug with an encoder it imports. */
function pack(rows) {
  const n = rows.length;
  const ids = Buffer.alloc(n * 4), xyz = Buffer.alloc(n * 4), w = Buffer.alloc(n * 2), tf = Buffer.alloc(n);
  const q = (v, bits) => Math.round(((v + 1) / 2) * (2 ** bits - 1));
  let prev = 0;
  rows.forEach((r, i) => {
    ids.writeInt32LE(r.id - prev, i * 4);
    prev = r.id;
    xyz.writeUInt32LE(q(r.xyz[0], 11) * 2 ** 21 + q(r.xyz[1], 11) * 2 ** 10 + q(r.xyz[2], 10), i * 4);
    w.writeUInt16LE(Math.round(r.w * 4095), i * 2);
    tf[i] = (Math.round(r.tone * 63) << 2) | (r.flags || 0);
  });
  const b = (x) => x.toString('base64');
  return { n, ids: b(ids), xyz: b(xyz), w: b(w), tf: b(tf) };
}

/* ── decodeMap ────────────────────────────────────────────────────────────── */
{
  const rows = [
    { id: 3, xyz: [-1, 0.5, 0.25], w: 0, tone: 0.2 },
    { id: 17, xyz: [1, -0.5, -0.125], w: 1, tone: 1, flags: 1 },
    { id: 40000, xyz: [0, 0, 0], w: 0.5, tone: 0.5, flags: 2 },
  ];
  const d = g.decodeMap(pack(rows));
  check(d.n === 3 && d.ids[0] === 3 && d.ids[1] === 17 && d.ids[2] === 40000,
    'decodeMap: ids are rebuilt from little-endian deltas, in order');
  check(Math.abs(d.xyz[0] + 1) < 1e-9 && Math.abs(d.xyz[1] - 0.5) < 1 / 2047 && Math.abs(d.xyz[5] + 0.125) < 1 / 1023
        && Math.abs(d.xyz[3] - 1) < 1e-9,
    'decodeMap: xyz are 11/11/10-bit fields of one Uint32, in order, within a quantisation step');
  check(d.w[0] === 0 && d.w[1] === 1 && Math.abs(d.w[2] - 0.5) < 1 / 4095, 'decodeMap: w is a 12-bit percentile');
  check(Math.abs(d.tone[0] - 0.2) < 1 / 63 && d.tone[1] === 1, 'decodeMap: tone shares its byte with the flags');
  check(d.flags[1] === g.FLAG_INFERRED && d.flags[2] === g.FLAG_NO_TONE, 'decodeMap: flags survive');
  const bad = pack(rows);
  bad.n = 4;
  let threw = false;
  try { g.decodeMap(bad); } catch { threw = true; }
  check(threw, 'decodeMap: columns that do not match n THROW — never a shuffled cloud');
  check(g.indexOfId(d.ids, 17) === 1 && g.indexOfId(d.ids, 18) === -1 && g.indexOfId(d.ids, 3) === 0,
    'indexOfId: binary search over the sorted ids');
}

/* ── a synthetic library ──────────────────────────────────────────────────── */
function library({ n = 3000, seed = 7, inferredShare = 0 } = {}) {
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
  const centres = Array.from({ length: 9 }, () => [rand() * 1.4 - 0.7, rand() * 1.4 - 0.7, rand() * 1.4 - 0.7, rand()]);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const c = centres[i % centres.length];
    rows.push({
      id: i + 1,
      xyz: [0, 1, 2].map((k) => Math.max(-1, Math.min(1, c[k] + gauss() * 0.18))),
      w: Math.max(0, Math.min(1, c[3] + gauss() * 0.12)),
      tone: rand(),
      flags: rand() < inferredShare ? 1 : 0,
    });
  }
  return g.decodeMap(pack(rows));
}

/* ── sliceMix ─────────────────────────────────────────────────────────────── */
{
  const m0 = g.sliceMix(0, 32), m1 = g.sliceMix(1, 32), mid = g.sliceMix(g.sliceW(5, 32), 32);
  check(m0.lo === 0 && m0.f === 0 && m1.hi === 31 && m1.f === 1,
    'sliceMix: holds the end slices past the first and last centres — no extrapolation');
  check(mid.lo === 5 && Math.abs(mid.f) < 1e-9, 'sliceMix: a slice centre is that slice exactly');
  let jumps = 0;
  let prev = g.sliceMix(0, 32);
  for (let i = 1; i <= 4096; i++) {
    const m = g.sliceMix(i / 4096, 32);
    const a = prev.lo + prev.f, b = m.lo + m.f;
    if (b < a - 1e-9 || b - a > 32 / 4096 + 1e-9) jumps++;
    prev = m;
  }
  check(jumps === 0, 'sliceMix: the slice coordinate is continuous and monotone across the whole rail');
}

/* ── the density field ────────────────────────────────────────────────────── */
const SMALL = { grid: 24, slices: 48, sigmaW: 0.06, sigmaVoxels: 0.625 };
{
  // Inferred rows NEVER feed the density.
  const measured = library({ n: 600, seed: 3 });
  const withInferred = g.decodeMap(pack([
    ...Array.from({ length: measured.n }, (_, i) => ({
      id: i + 1, xyz: [measured.xyz[i * 3], measured.xyz[i * 3 + 1], measured.xyz[i * 3 + 2]],
      w: measured.w[i], tone: measured.tone[i], flags: 0,
    })),
    ...Array.from({ length: 400 }, (_, i) => ({ id: 10000 + i, xyz: [0.9, 0.9, 0.9], w: 0.5, tone: 0.5, flags: 1 })),
  ]));
  const a = g.densitySlices(measured, SMALL), b = g.densitySlices(withInferred, SMALL);
  let same = a.rhoRef === b.rhoRef;
  for (let j = 0; j < SMALL.slices && same; j++) {
    for (let v = 0; v < a.density[j].length; v++) if (a.density[j][v] !== b.density[j][v]) { same = false; break; }
  }
  check(same, 'density: 400 inferred rows stacked on one point change NOTHING — no album-sized hot spot');

  // Blur conserves mass (clamped edges).
  const G = 24, field = new Float32Array(G ** 3);
  field[(12 * G + 12) * G + 12] = 5;
  g.blur3d(field, G, 1.25);
  const sum = field.reduce((s, x) => s + x, 0);
  check(Math.abs(sum - 5) < 1e-3, `blur3d: an interior impulse keeps its mass (${sum.toFixed(5)})`);
  check(field[(12 * G + 12) * G + 13] > 0 && field[(12 * G + 12) * G + 13] < field[(12 * G + 12) * G + 12],
    'blur3d: spreads to neighbours, peak stays at the centre');
  // Off-centre, so a pass that blurred one axis twice and another never cannot hide:
  // every axis must spread the impulse equally.
  const off = new Float32Array(G ** 3);
  const at = (x, y, z) => (z * G + y) * G + x;
  off[at(5, 12, 19)] = 1;
  g.blur3d(off, G, 1.25);
  const nx = off[at(6, 12, 19)], ny = off[at(5, 13, 19)], nz = off[at(5, 12, 20)];
  check(nx > 0.01 && Math.abs(nx - ny) < 1e-6 && Math.abs(ny - nz) < 1e-6 && off[at(5, 12, 19)] > nx,
    `blur3d: x, y and z each spread an off-centre impulse equally (${nx.toFixed(5)} / ${ny.toFixed(5)} / ${nz.toFixed(5)})`);
}
{
  // ⚠️ ONE TONE MAP FOR EVERY SLICE. A sparse cluster (20 tracks, calm) and a dense one
  // (2,000 tracks, intense) at the same size: the sparse one must stay faint at its own
  // energy. Per-slice normalisation would make both peaks ~1.
  const rows = [];
  const rand = mulberry32(11);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
  for (let i = 0; i < 20; i++) rows.push({ id: i + 1, xyz: [gauss() * 0.1 - 0.5, gauss() * 0.1, gauss() * 0.1], w: 0.1, tone: 0.2 });
  for (let i = 0; i < 2000; i++) rows.push({ id: 100 + i, xyz: [gauss() * 0.1 + 0.5, gauss() * 0.1, gauss() * 0.1], w: 0.9, tone: 0.8 });
  const map = g.decodeMap(pack(rows.sort((x, y) => x.id - y.id)));
  const f = g.densitySlices(map, SMALL);
  const peakAlpha = (w) => {
    const { lo } = g.sliceMix(w, SMALL.slices);
    let m = 0;
    for (let v = 0; v < f.textures[lo].length; v += 2) m = Math.max(m, f.textures[lo][v]);
    return m;
  };
  const sparse = peakAlpha(0.1), dense = peakAlpha(0.9);
  check(dense > 200 && sparse < dense * 0.35,
    `tone map: shared across slices — the sparse calm cluster peaks at α ${sparse}, the dense intense one at ${dense}`);
  // The tone channel is the density-weighted MEAN tone, not a sum.
  const { lo } = g.sliceMix(0.9, SMALL.slices);
  let best = 0, at = 0;
  for (let v = 0; v < f.textures[lo].length; v += 2) if (f.textures[lo][v] > best) { best = f.textures[lo][v]; at = v; }
  check(Math.abs(f.textures[lo][at + 1] - 0.8 * 255) <= 2,
    `tone: the dense cluster's colour is its mean brightness (${f.textures[lo][at + 1]} ≈ ${0.8 * 255})`);
  check(g.toneMap(0, 1) === 0 && g.toneMap(1, 1) > g.toneMap(0.5, 1) && g.toneMap(1e9, 1) <= 1,
    'toneMap: 0 at empty, monotone, bounded by 1');
}

/* ── G7: continuity, MEASURED on the production settings ───────────────────────
   ⚠️ As first declared, G7 read "max voxel change between w and w + 1/256 ≤ 2% of
   ρ_ref". That measures the DATA: on this fixture the exact continuous field itself
   changes 7.05% of ρ_ref per 1/256 (cluster cores sit at ~3× ρ_ref), so no faithful
   renderer can pass it. What G7 exists to prove is that SLICING adds nothing — that
   the cloud drawn at any w is the true field at that w, so a swipe morphs instead of
   stepping or pulsing. So it is held as that: the opacity the renderer mixes from its
   two slices stays within 0.02 of the exact field's opacity, at the midpoint of every
   slice interval and the quarter points of every fourth. (32 slices measured 0.0193;
   48 measure 0.0081. ALGORITHMS.md §9 M6.) */
{
  const map = library({ n: 3000, seed: 7 });
  const t0 = Date.now();
  const f = g.densitySlices(map, g.DENSITY);
  const ms = Date.now() - t0;
  const O = g.DENSITY, G3 = O.grid ** 3, S = O.slices;
  const d = new Float32Array(G3), t = new Float32Array(G3), scratch = new Float32Array(G3);
  let worst = 0, at = 0, dataChange = 0;
  const exactAlpha = (w) => {
    g.splatAt(map, w, O, d, t);
    g.blur3d(d, O.grid, O.sigmaVoxels, scratch);
    return Float32Array.from(d, (rho) => g.toneMap(rho, f.rhoRef));
  };
  for (let j = 0; j < S - 1; j++) {
    for (const q of j % 4 === 0 ? [0.25, 0.5, 0.75] : [0.5]) {
      const w = g.sliceW(j, S) + q / S;
      const exact = exactAlpha(w);
      for (let v = 0; v < G3; v++) {
        const e = Math.abs(g.alphaAt(f, w, v) - exact[v]);
        if (e > worst) { worst = e; at = w; }
      }
      if (j === Math.floor(S / 2) && q === 0.5) {
        const later = exactAlpha(w + 1 / 256);
        for (let v = 0; v < G3; v++) dataChange = Math.max(dataChange, Math.abs(later[v] - exact[v]));
      }
    }
  }
  check(worst <= 0.02,
    `G7: the slice mix IS the continuous field — worst opacity error ${worst.toFixed(4)} (≤ 0.02, at w = ${at.toFixed(3)}); ` +
    `for scale, the data's own change per 1/256 near the middle is ${dataChange.toFixed(4)}; ` +
    `${S} slices × ${O.grid}³ built in ${ms} ms`);
  check(f.textures.length === S && f.textures[0].length === 2 * G3, `densitySlices: ${S} RG8 slices of ${O.grid}³`);
  check(S * 0.06 >= 2.5, 'densitySlices: slices at most a third of σ_w apart — the spacing G7 was measured at');
}

/* ── glints, labels, words ────────────────────────────────────────────────── */
check(g.glint(0) === 1 && g.glint(0.04) < 0.4 && g.glint(0.12) < 1e-3, 'glint: full on its slice, gone by ±0.12');
check(g.labelAlpha(0.08) > g.glint(0.08), 'labelAlpha: names outlast the glints');
check(g.energyWord(0) === 'calm' && g.energyWord(0.5) === 'steady' && g.energyWord(1) === 'intense',
  'energyWord: calm … intense, the rail read aloud');

/* ── gestures ─────────────────────────────────────────────────────────────── */
check(g.scrubTo(0.5, -100, 400) === 0.75 && g.scrubTo(0.5, 100, 400) === 0.25 && g.scrubTo(0.9, -1000, 400) === 1,
  'scrubTo: dragging UP is more intense, a field height is the whole rail, clamped');
{
  const stops = [0.1, 0.3, 0.5, 0.7, 0.9];
  check(g.projectedStop(0.52, 0, stops) === 0.5 && g.projectedStop(0.42, 2, stops) === 0.9,
    'projectedStop: a still release settles on the nearest stop, a flick travels');
  check(g.nextStop(0.5, stops, 1) === 0.7 && g.nextStop(0.5, stops, -1) === 0.3 && g.nextStop(0.95, stops, 1) === 0.9,
    'nextStop: ↑/↓ step to the neighbouring stop, holding at the ends');
  let s = { x: 0.42, v: 2 }, over = 0;
  for (let i = 0; i < 120; i++) { s = g.wStep(s, 0.9, 1 / 60); over = Math.max(over, s.x - 0.9); }
  check(Math.abs(s.x - 0.9) < 1e-3 && over < 0.05, `wStep: a flick lands on its stop (overshoot ${over.toFixed(4)})`);
}

/* ── picking ──────────────────────────────────────────────────────────────── */
{
  const densest = g.pickDensest([0, 0, 5], [0, 0, -1], (p) => Math.exp(-((p[2] - 0.4) ** 2) * 50));
  check(densest && Math.abs(densest[2] - 0.4) < 0.05, 'pickDensest: finds the density peak along the ray');
}

/* The axis lock, velocity, the coast, the nearest-glint pick, the ray through the
   cube, the double-tap and label thinning are @jkos/scene's, held by its own test. */

/* ── the colour ramp (dataviz: sequential — one hue, lightness-ordered) ─────── */
{
  const accents = { amber: [1, 0.69, 0], teal: [0.31, 0.8, 0.77], slate: [0.45, 0.47, 0.5] };
  for (const [name, accent] of Object.entries(accents)) {
    for (const face of ['dark', 'paper']) {
      const ramp = g.brightnessRamp(accent, face);
      const L = [], H = [];
      for (let i = 0; i < 256; i++) {
        const [l, c, h] = scene.srgbToOklch([ramp[i * 3] / 255, ramp[i * 3 + 1] / 255, ramp[i * 3 + 2] / 255]);
        L.push(l);
        if (c > 0.03) H.push(h);
      }
      const dir = face === 'dark' ? 1 : -1;
      let monotone = true;
      for (let i = 8; i < 256; i += 8) if ((L[i] - L[i - 8]) * dir <= 0) monotone = false;
      const hueSpread = H.length ? Math.max(...H) - Math.min(...H) : 0;
      check(monotone && Math.abs(L[255] - L[0]) > 0.4,
        `brightnessRamp(${name}, ${face}): lightness ${dir > 0 ? 'rises' : 'falls'} monotonically across ${Math.abs(L[255] - L[0]).toFixed(2)} of L`);
      check(hueSpread < 0.12, `brightnessRamp(${name}, ${face}): ONE hue (spread ${hueSpread.toFixed(3)} rad) — never a rainbow`);
      // The faint end must still separate from the surface it is drawn on (hub.css
      // --hub-bg-0 per face): the first paper ramp began at L 0.80 on a 0.91 page and a
      // dark-timbre glint vanished into it.
      const surface = face === 'dark' ? [0x11, 0x10, 0x0d] : [0xed, 0xe2, 0xc8];
      const [Ls] = scene.srgbToOklch(surface.map((v) => v / 255));
      check(Math.abs(L[0] - Ls) >= 0.2,
        `brightnessRamp(${name}, ${face}): its faint end stands ${Math.abs(L[0] - Ls).toFixed(2)} of L off the surface (≥ 0.2)`);
    }
  }
}

/* ── the camera keeps the library in a portrait frame ─────────────────────── */
{
  const aspect = 390 / 520;
  const d = g.frameDistance(aspect);
  let inside = true;
  for (let deg = 0; deg < 360; deg += 15) {
    const view = g.spaceView(deg * Math.PI / 180, [0, 0, 0], d, aspect);
    // The unit sphere holds 98% of tracks by construction (xyz is scaled by the p98
    // radius): sample its surface densely.
    for (let t = 0; t < 180; t += 15) for (let p = 0; p < 360; p += 15) {
      const th = t * Math.PI / 180, ph = p * Math.PI / 180;
      const q = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const s = scene.toScreen(view.viewProj, q, 390, 520);
      if (!s || s.x < 0 || s.x > 390 || s.y < 0 || s.y > 520) inside = false;
    }
  }
  check(inside, `frameDistance: the unit sphere (98% of tracks) stays in a 390×520 portrait frame at every yaw (distance ${d.toFixed(2)})`);
  const vHalf = g.CAMERA.fov / 2, hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const corners = Math.sqrt(3) / Math.sin(Math.min(vHalf, hHalf));
  check(d < corners * 0.7,
    `frameDistance: and no further than that needs (${d.toFixed(2)} vs ${corners.toFixed(2)} to frame the empty corners)`);
}

/* ── purity ───────────────────────────────────────────────────────────────── */
{
  const src = readFileSync(resolve(root, GEOMETRY), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const clocks = ['setInterval', 'setTimeout', 'Date.now', 'performance.now', 'requestAnimationFrame'].filter((b) => src.includes(b));
  check(!clocks.length, `purity: geometry.ts holds no clock (${clocks.join(', ') || 'none'}) — velocities use the caller's timestamps`);
  check(!/\b(document|window)\./.test(src), 'purity: geometry.ts touches no DOM, so the density worker can run it');
}

if (failed) {
  console.error(`\n✗ vibespace: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ vibespace: all assertions passed');
