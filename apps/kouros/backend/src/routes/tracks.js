'use strict';
// routes/tracks.js — the `tracks` dataset (the read contract, git history: item 18.2). A filtered
// list read over the shared catalog the scanner (src/library/scan.js) populates.
// Filters DERIVED from the dataset's own declaration (buildItemFilters/filterSpec —
// single source, P3) — mirrors papyros's src/routes/books.js. Read-only: `tracks` has
// no per-user owner column (shared catalog, like `books`), so unlike playlists/
// history/ratings there is no owner-pin base clause and no seed.

const { Router } = require('express');
const { buildItemFilters, filterSpec } = require('@jkos/weave/server');
const { DATASETS, TRACK_SHAPE } = require('../../discovery');

/* The weave filter vocabulary for tracks — which query param maps to which column and
   operator, PROJECTED from the DATASETS `tracks.filters` declaration (P3) rather than
   hand-typed a second time. */
const TRACKS_FILTER_SPEC = filterSpec(
  DATASETS.datasets.find((d) => d.id === 'tracks').filters,
);

/* The SELECT column list is DERIVED from TRACK_SHAPE (discovery.js) — the fields the
   dataset doc says a `tracks` row carries and the columns this route actually queries
   are the same array, not two hand-synced lists. The heavy `files`/`chapters` JSON
   blobs and the filesystem `path` are deliberately NOT in TRACK_SHAPE, so they never
   leak into the list response. */
const TRACK_COLUMNS = TRACK_SHAPE.map((f) => f.name);
const SELECT_SQL = `SELECT ${TRACK_COLUMNS.join(', ')} FROM tracks`;

/** `genres` is a JSON-array TEXT column; every other TRACK_SHAPE field is a plain
 *  SQLite scalar already JSON-ready as-is. */
function toRow(r) {
  return { ...r, genres: r.genres ? JSON.parse(r.genres) : [] };
}

/**
 * @param {{ db: import('better-sqlite3').Database }} deps
 */
function createTracksRouter({ db }) {
  const router = Router();

  router.get('/api/tracks', (req, res) => {
    try {
      const { where, params } = buildItemFilters(req.query, TRACKS_FILTER_SPEC);
      const sql = `${SELECT_SQL}${where ? ` WHERE ${where}` : ''} ORDER BY artist ASC, album ASC, disc_no ASC, track_no ASC, title ASC`;
      const rows = db.prepare(sql).all(...params);
      // Bare array, not { tracks } — the weave read contract (weaveClient.list /
      // useWeaveList coerce with Array.isArray; an enveloped list reads as empty).
      res.json(rows.map(toRow));
    } catch (err) {
      console.error(`[kouros] tracks list failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to list tracks' });
    }
  });

  return router;
}

module.exports = { createTracksRouter, TRACKS_FILTER_SPEC };
