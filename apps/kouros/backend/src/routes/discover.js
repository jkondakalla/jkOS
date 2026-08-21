'use strict';
// routes/discover.js — the HTTP surface over src/discover (the similarity engine).
//
// Every response carries the BASIS of its answer ('embedding' | 'metadata' |
// 'none') and, where relevant, the per-row origin ('measured' | 'inferred'). That
// is not decoration: the embedder backfills over hours, so at any moment part of
// the library has a real vector, part inherits its album's, and part has nothing
// at all. A UI that cannot tell those apart will present a genre guess as an
// acoustic match, and the first time that is obvious to the listener the whole
// feature stops being trusted. Cheaper to be honest on the wire.
const { Router } = require('express');

function ids(param) {
  return String(param || '')
    .split(',')
    .map((s) => Number.parseInt(s, 10))
    .filter(Number.isFinite);
}

function clamp(v, dflt, min, max) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(n, max));
}

function num(v, dflt) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * @param {{ discovery: ReturnType<typeof import('../discover').createDiscovery>,
 *           db: import('better-sqlite3').Database }} deps
 */
function createDiscoverRouter({ discovery, db }) {
  const router = Router();
  const home = require('../discover/home');

  /** This user's play history, newest first — the input to every personalised
   *  rail. Read directly rather than over the collection route: this is the same
   *  process, and a self-HTTP call to read one's own table is a round trip for
   *  nothing. Owner-scoped exactly as the collection would. */
  function historyFor(req, limit = 400) {
    const sub = req.user && req.user.sub;
    if (sub == null) return [];
    try {
      return db.prepare(
        'SELECT item_ref, started_at, ms_played, completed, updated_at FROM history WHERE user_id = ? ORDER BY id DESC LIMIT ?'
      ).all(sub, limit);
    } catch (err) {
      console.warn(`[kouros discover] history read failed: ${err.message}`);
      return [];
    }
  }

  /* Coverage — what the embedder has actually reached. The vibe map and every
     "why is this rail empty" question in the UI reads this. */
  router.get('/api/discover/stats', (_req, res) => {
    try {
      res.json(discovery.stats());
    } catch (err) {
      console.error(`[kouros] discover stats failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to read discovery stats' });
    }
  });

  /* More like this. */
  router.get('/api/discover/similar/:id', (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
      res.json(discovery.similar(id, { k: clamp(req.query.k, 24, 1, 100) }));
    } catch (err) {
      console.error(`[kouros] similar failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to find similar tracks' });
    }
  });

  /* An endless station around one or more seed tracks. */
  router.get('/api/discover/radio', (req, res) => {
    try {
      const seeds = ids(req.query.seed);
      if (!seeds.length) return res.status(400).json({ error: 'seed is required' });
      res.json(discovery.radio(seeds, { k: clamp(req.query.k, 60, 1, 200) }));
    } catch (err) {
      console.error(`[kouros] radio failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to build radio' });
    }
  });

  /* One run — a sequenced set with an arc. */
  router.get('/api/discover/run', (req, res) => {
    try {
      const seedId = Number.parseInt(req.query.seed, 10);
      if (!Number.isFinite(seedId)) return res.status(400).json({ error: 'seed is required' });
      res.json(discovery.run({
        seedId,
        length: clamp(req.query.length, 14, 3, 60),
        arc: String(req.query.arc || 'rise'),
      }));
    } catch (err) {
      console.error(`[kouros] run failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to build run' });
    }
  });

  /* The vibe map: every embedded track's 2-D position, the labelled regions, and
     what the two axes turned out to mean. Cached in the service. */
  router.get('/api/discover/map', (_req, res) => {
    try {
      res.json(discovery.map());
    } catch (err) {
      console.error(`[kouros] map failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to build vibe map' });
    }
  });

  /* What sits under the pin. The map is a unit square, so x/y are in [-1, 1]. */
  router.get('/api/discover/near', (req, res) => {
    try {
      const x = num(req.query.x, NaN);
      const y = num(req.query.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return res.status(400).json({ error: 'x and y are required' });
      res.json({ results: discovery.nearPoint(x, y, { k: clamp(req.query.k, 40, 1, 120) }) });
    } catch (err) {
      console.error(`[kouros] near failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to read the map' });
    }
  });

  /* The whole Home page in ONE request. Home is five rails; five round trips on a
     phone is five chances to paint half a screen. The rails are independent and
     all cheap once the space is built, so they are assembled together. */
  router.get('/api/discover/home', (req, res) => {
    try {
      const space = discovery.current();
      const history = historyFor(req);
      // The client sends its own local hour — the server's clock is UTC in a
      // container and "morning" is a property of where the LISTENER is, not of
      // where the process runs. Falls back to the server hour when absent.
      const hour = clamp(req.query.hour, new Date().getHours(), 0, 23);
      res.json({
        stats: space.stats,
        time_of_day: home.timeOfDay(space, { hour, k: clamp(req.query.k, 18, 1, 60) }),
        runs: home.runs(space, history, { count: 3, length: 14 }),
        deep_in: home.deepIn(space, history, { k: 8 }),
        recently_played: home.recentlyPlayed(space, history, { k: 18 }),
        fresh_albums: home.freshAlbums(db, space, { k: 18 }),
      });
    } catch (err) {
      console.error(`[kouros] home failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to build home' });
    }
  });

  return router;
}

module.exports = { createDiscoverRouter };
