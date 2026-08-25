// seed.mjs — listening history and playlists, written straight into kouros.db AFTER
// the scan has assigned track ids.
//
// Two of Home's five rails are pure history — "Deep in" (recency-weighted, 10-day
// half-life) and "Picked up" (most recent play per track) — and Playlists is an
// entire tab. All three render as an absent rail or an empty state on a fresh
// database, which is precisely the part of the design that cannot be judged.
//
// The history is shaped, not random: one artist is the current obsession, a second
// is fading out of one, and a long tail runs back three months. `ORDER BY id DESC`
// is the collection's list order, so rows are inserted OLDEST FIRST — insert them
// newest-first and "recently played" shows you last quarter.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { rng, hash } from './art.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', '..', 'apps', 'kouros', 'backend', 'package.json'));

const DAY = 86_400_000;

/** The playlists a real user would have: one from a night, one from a mood, one
 *  half-finished, one long. `pick` selects from the scanned catalog by predicate. */
const PLAYLISTS = [
  { name: 'Late desk',       description: 'Low, wide and unhurried. Nothing with words in it.',
    pick: (t) => /Ambient|Instrumental|Classical|Post-Rock/i.test(t.genres), n: 22 },
  { name: 'Loud Friday',     description: '', pick: (t) => /Punk|Metal|Rock/i.test(t.genres), n: 17 },
  { name: 'Kitchen radio',   description: 'For the ten minutes before anyone else is up.',
    pick: (t) => /Folk|Americana|Acoustic|Jazz/i.test(t.genres), n: 14 },
  { name: 'the tide one',    description: 'started this and never finished it',
    pick: (t) => /Hollow Coast|Ilse Brandt/i.test(t.artist), n: 4 },
  { name: 'Everything 2024–2025', description: 'Whatever arrived this year.',
    pick: (t) => t.year >= 2023, n: 26 },
];

/** The two artists the history leans on, and how long ago each peaked. */
const OBSESSIONS = [
  { artist: 'Vesper Lane',   peakDaysAgo: 2,  weight: 34 },
  { artist: 'NULLSET',       peakDaysAgo: 6,  weight: 26 },
  { artist: 'Hollow Coast',  peakDaysAgo: 22, weight: 18 },
  { artist: 'Rowan Meade',   peakDaysAgo: 41, weight: 14 },
];

export function seed({ dbPath, userId = 1, plays = 420, now = Date.now(), seedValue = 0xc0ffee } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const rand = rng(seedValue);

  const tracks = db.prepare(
    `SELECT id, title, artist, album, albumartist, year, genres, duration FROM tracks`).all();
  if (!tracks.length) {
    db.close();
    throw new Error(`seed: ${dbPath} has no tracks — run the scan before seeding`);
  }

  db.prepare(`DELETE FROM history WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM playlists WHERE user_id = ?`).run(userId);

  /* ── history ──────────────────────────────────────────────────────────────── */
  // A weighted bag: the obsessions get a heavy share of the plays and a date
  // clustered around their peak, everything else is scattered over 90 days.
  const byArtist = new Map();
  for (const t of tracks) {
    const key = t.artist || t.albumartist || '';
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(t);
  }

  const events = [];
  const totalWeight = OBSESSIONS.reduce((s, o) => s + o.weight, 0);
  for (let i = 0; i < plays; i++) {
    let pool = null, whenDaysAgo;
    const roll = rand() * 100;
    if (roll < totalWeight) {
      let acc = 0, chosen = OBSESSIONS[0];
      for (const o of OBSESSIONS) { acc += o.weight; if (roll < acc) { chosen = o; break; } }
      pool = byArtist.get(chosen.artist);
      // A half-normal around the peak: plays thin out on both sides of it.
      whenDaysAgo = Math.max(0.02, chosen.peakDaysAgo + (rand() + rand() + rand() - 1.5) * 7);
    } else {
      whenDaysAgo = rand() * 90;
    }
    if (!pool || !pool.length) pool = tracks;
    const t = pool[Math.floor(rand() * pool.length)];
    // Real listening is not all completions: a fifth of plays are skips or partials,
    // which is what makes "ms_played" a column worth having.
    const r = rand();
    const fraction = r < 0.12 ? 0.02 + rand() * 0.15 : r < 0.2 ? 0.4 + rand() * 0.4 : 1;
    events.push({
      item_ref: t.id,
      at: now - whenDaysAgo * DAY,
      ms_played: Math.round((t.duration || 200) * 1000 * fraction),
      completed: fraction >= 1 ? 1 : 0,
    });
  }
  events.sort((a, b) => a.at - b.at);            // oldest first — see the header

  const insHistory = db.prepare(
    `INSERT INTO history (user_id, item_ref, started_at, ms_played, completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const e of events) {
      const iso = new Date(e.at).toISOString();
      insHistory.run(userId, e.item_ref, iso, e.ms_played, e.completed, iso, iso);
    }
  })();

  /* ── playlists ────────────────────────────────────────────────────────────── */
  const insPlaylist = db.prepare(
    `INSERT INTO playlists (user_id, name, description, track_refs, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`);
  let made = 0;
  db.transaction(() => {
    for (const spec of PLAYLISTS) {
      const pool = tracks.filter(spec.pick);
      if (!pool.length) continue;
      // Deterministic per playlist name, so a regeneration does not reshuffle them.
      const pr = rng(hash(spec.name));
      const shuffled = [...pool].sort(() => pr() - 0.5).slice(0, spec.n);
      const created = new Date(now - (2 + made * 9) * DAY).toISOString();
      insPlaylist.run(
        userId, spec.name, spec.description,
        JSON.stringify(shuffled.map((t) => t.id)), created, created,
      );
      made++;
    }
  })();

  const counts = {
    history: events.length,
    playlists: made,
    tracks: tracks.length,
    newestPlay: new Date(events[events.length - 1].at).toISOString(),
  };
  db.close();
  return counts;
}
