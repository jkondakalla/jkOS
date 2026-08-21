'use strict';
// home.js — the Home page's rails, assembled server-side.
//
// Home is the screen the brief singled out as the thing Plexamp gets wrong, and
// the failure mode it describes is specific: a home page that is a list of
// FOLDERS. So none of these rails is "your albums, sorted". Each answers a
// question a person actually has when they open a music app:
//
//   runs        "give me a set that goes somewhere"      → embeddings + an energy arc
//   timeOfDay   "something that fits right now"          → the readable feature axes
//   deepIn      "more of what I'm currently obsessed by" → play history, recency-weighted
//   recent      "the thing I was just listening to"      → history
//   fresh       "what's new in here"                     → catalog recency
//
// Rails degrade individually. With no embeddings, `runs` is absent and
// `timeOfDay` falls back to genre heuristics — the page still works, it just has
// fewer opinions, and every rail states its own basis so the UI never implies
// otherwise.
const { NFEAT, FEATURE_NAMES, ORIGIN } = require('./space');
const { present, diversify, round, contentKeyAt } = require('./queries');
const { makeRun } = require('./queries');

/* ── time of day ──────────────────────────────────────────────────────────────
   Targets in the readable feature space (all 0–1 percentile ranks). These are
   deliberately soft: a slot is a REGION of the space, not a filter, and a track
   is scored by distance to the target rather than passing or failing a test. */
const SLOTS = {
  morning: {
    label: 'Morning',
    hours: [5, 11],
    target: { energy: 0.45, brightness: 0.7, tempo: 0.5, fuzz: 0.3 },
    genres: ['folk', 'indie', 'pop', 'jazz', 'acoustic'],
  },
  working: {
    label: 'Working',
    hours: [11, 18],
    target: { energy: 0.5, brightness: 0.5, tempo: 0.55, drive: 0.65, fuzz: 0.35 },
    genres: ['electronic', 'ambient', 'instrumental', 'post-rock'],
  },
  evening: {
    label: 'Evening',
    hours: [18, 23],
    target: { energy: 0.72, brightness: 0.55, tempo: 0.65, fuzz: 0.55 },
    genres: ['rock', 'punk', 'alternative', 'metal'],
  },
  late: {
    label: 'Late',
    hours: [23, 5],
    target: { energy: 0.2, brightness: 0.28, tempo: 0.3, fuzz: 0.25 },
    genres: ['ambient', 'jazz', 'classical', 'shoegaze', 'downtempo'],
  },
};

/** Which slot a given local hour falls in. `late` wraps midnight, so it is
 *  matched by exclusion rather than by a comparison that would never be true. */
function slotForHour(h) {
  for (const [key, s] of Object.entries(SLOTS)) {
    const [a, b] = s.hours;
    if (a < b ? h >= a && h < b : h >= a || h < b) return key;
  }
  return 'working';
}

function timeOfDay(space, { hour, k = 18 } = {}) {
  const key = slotForHour(hour);
  const slot = SLOTS[key];

  if (space.features) {
    const idx = {};
    for (const f of Object.keys(slot.target)) {
      const j = FEATURE_NAMES.indexOf(f);
      if (j >= 0) idx[f] = j;
    }
    const scored = [];
    for (let i = 0; i < space.n; i++) {
      if (space.origin[i] === ORIGIN.NONE) continue;   // no features ⇒ no opinion
      let d2 = 0, terms = 0;
      for (const [f, j] of Object.entries(idx)) {
        const diff = space.features[i * NFEAT + j] - slot.target[f];
        d2 += diff * diff; terms++;
      }
      if (!terms) continue;
      scored.push([i, -Math.sqrt(d2 / terms)]);
    }
    if (scored.length >= k) {
      scored.sort((a, b) => b[1] - a[1]);
      const rows = diversify(space, scored, { k, perArtist: 2, perAlbum: 1 });
      return {
        slot: key, label: slot.label, basis: 'features',
        results: rows.map(([i, s]) => present(space, i, { fit: round(1 + s) })),
      };
    }
  }

  // Fallback: genre affinity for the slot, then recency as a tiebreak.
  const want = new Set(slot.genres);
  const scored = [];
  for (let i = 0; i < space.n; i++) {
    const gs = space.meta.genres[i].map((g) => String(g).toLowerCase());
    let hit = 0;
    for (const g of gs) for (const w of want) if (g.includes(w)) { hit++; break; }
    if (hit) scored.push([i, hit]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const rows = diversify(space, scored, { k, perArtist: 2, perAlbum: 1 });
  return { slot: key, label: slot.label, basis: 'genre', results: rows.map(([i, s]) => present(space, i, { fit: round(s) })) };
}

/* ── artists you're deep in ───────────────────────────────────────────────────
   Recency-weighted play counts. A play from this morning should outweigh one
   from three weeks ago, so each play contributes exp(-age/halfLife) rather than
   1. Without that, "deep in right now" degenerates into "your all-time top
   artists", which never changes and is therefore never interesting. */
function deepIn(space, history, { k = 8, halfLifeDays = 10, now = Date.now() } = {}) {
  const weightByArtist = new Map();
  const tracksByArtist = new Map();
  const HALF = halfLifeDays * 864e5;

  for (const h of history) {
    const i = space.index.get(h.item_ref);
    if (i == null) continue;
    const artist = space.meta.artist[i];
    if (!artist) continue;
    const age = Math.max(0, now - Date.parse(h.started_at || h.updated_at || 0));
    const w = Math.pow(0.5, age / HALF);
    if (!Number.isFinite(w)) continue;
    weightByArtist.set(artist, (weightByArtist.get(artist) || 0) + w);
    if (!tracksByArtist.has(artist)) tracksByArtist.set(artist, []);
    tracksByArtist.get(artist).push(i);
  }

  const ranked = [...weightByArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  return ranked.map(([artist, weight]) => {
    // A representative cover: the most-played track of theirs that has one.
    const rows = tracksByArtist.get(artist) || [];
    const withCover = rows.find((i) => space.meta.cover[i]);
    const anchor = withCover != null ? withCover : rows[0];
    // How much of this artist the library actually holds — the "go deeper" hook.
    let total = 0;
    for (let i = 0; i < space.n; i++) if (space.meta.artist[i] === artist) total++;
    return {
      artist,
      weight: round(weight),
      plays: rows.length,
      library_tracks: total,
      anchor_id: anchor != null ? space.ids[anchor] : null,
    };
  });
}

/* ── runs ─────────────────────────────────────────────────────────────────────
   Two or three sets, seeded from what the listener has actually been playing
   (falling back to the library's embedded tracks when there is no history yet),
   each with a different arc so the rail offers genuinely different shapes rather
   than three orderings of the same songs. */
const RUN_SHAPES = [
  { arc: 'rise',      title: 'Build',      blurb: 'starts easy, ends loud' },
  { arc: 'wind_down', title: 'Wind down',  blurb: 'comes back down' },
  { arc: 'peak',      title: 'Arc',        blurb: 'rises, peaks, settles' },
];

function runs(space, history, { count = 3, length = 14 } = {}) {
  if (!space.dim || !space.stats.covered) return [];

  const seeds = [];
  const seen = new Set();
  for (const h of history) {
    const i = space.index.get(h.item_ref);
    if (i == null || space.origin[i] === ORIGIN.NONE) continue;
    const key = (space.meta.artist[i] || '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push(space.ids[i]);
    if (seeds.length >= count) break;
  }
  // No usable history — seed from embedded tracks spread across the catalog, so a
  // brand-new listener still gets three different-sounding runs rather than three
  // from whatever happens to sort first.
  if (seeds.length < count) {
    const embedded = [];
    for (let i = 0; i < space.n; i++) if (space.origin[i] !== ORIGIN.NONE) embedded.push(i);
    const stride = Math.max(1, Math.floor(embedded.length / count));
    for (let s = 0; s < embedded.length && seeds.length < count; s += stride) {
      const id = space.ids[embedded[s]];
      if (!seeds.includes(id)) seeds.push(id);
    }
  }

  const out = [];
  for (let n = 0; n < seeds.length && n < count; n++) {
    const shape = RUN_SHAPES[n % RUN_SHAPES.length];
    const built = makeRun(space, { seedId: seeds[n], length, arc: shape.arc });
    if (built.results.length < 4) continue;   // too thin to be a "set"
    const seedRow = built.results[0];
    out.push({
      id: `${shape.arc}:${seeds[n]}`,
      title: shape.title,
      blurb: shape.blurb,
      arc: built.arc,
      seed: { id: seedRow.id, title: seedRow.title, artist: seedRow.artist },
      length: built.results.length,
      duration: Math.round(built.results.reduce((s, r) => s + (r.duration || 0), 0)),
      tracks: built.results,
    });
  }
  return out;
}

/* ── the plain rails ──────────────────────────────────────────────────────── */

/** Most recent play per track, newest first — history arrives newest-first from
 *  the append-only collection, so first-seen IS most-recent. */
function recentlyPlayed(space, history, { k = 18 } = {}) {
  const seen = new Set();
  const out = [];
  for (const h of history) {
    if (seen.has(h.item_ref)) continue;
    seen.add(h.item_ref);
    const i = space.index.get(h.item_ref);
    if (i == null) continue;
    out.push(present(space, i, { played_at: h.started_at || h.updated_at }));
    if (out.length >= k) break;
  }
  return out;
}

/** Newest ALBUMS rather than newest tracks: a freshly-added record would
 *  otherwise fill the whole rail with its own twelve tracks. */
function freshAlbums(db, space, { k = 18 } = {}) {
  const rows = db.prepare(`
    SELECT album, albumartist, artist, MAX(updated_at) AS added, MIN(id) AS anchor_id,
           COUNT(*) AS tracks, SUM(duration) AS duration, MAX(year) AS year
      FROM tracks
     WHERE album IS NOT NULL AND album <> ''
     GROUP BY album, COALESCE(albumartist, artist)
     ORDER BY added DESC
     LIMIT ?
  `).all(k);
  return rows.map((r) => ({
    album: r.album,
    artist: r.albumartist || r.artist,
    year: r.year || null,
    tracks: r.tracks,
    duration: Math.round(r.duration || 0),
    anchor_id: r.anchor_id,
    added: r.added,
  }));
}

module.exports = { timeOfDay, deepIn, runs, recentlyPlayed, freshAlbums, slotForHour, SLOTS };
