'use strict';
// routes/books.js — the `books` dataset (task 2.4, the read contract). A filtered list
// read over the shared catalog the scanner (2.3, src/library/scan.js) populates. Filters
// are DERIVED from the dataset's own declaration (buildItemFilters/filterSpec — single
// source, P3) so what discovery.js DECLARES this dataset can be read by is exactly what
// this route enforces — the same pattern apps/beigeboard/backend/src/routes/items.js
// uses for `items`. Read-only: `books` has no per-user owner column (2.1 — it's a
// SHARED catalog), so unlike items there is no owner-pin base clause and no seed.

const { Router } = require('express');
const { buildItemFilters, filterSpec } = require('@jkos/weave/server');
const { DATASETS, BOOK_SHAPE } = require('../../discovery');

/* The weave filter vocabulary for books — which query param maps to which column and
   operator, PROJECTED from the DATASETS `books.filters` declaration (P3) rather than
   hand-typed a second time. */
const BOOKS_FILTER_SPEC = filterSpec(
  DATASETS.datasets.find((d) => d.id === 'books').filters,
);

/* The SELECT column list is DERIVED from BOOK_SHAPE (discovery.js) — the fields the
   dataset doc says a `books` row carries and the columns this route actually queries
   are the same array, not two hand-synced lists. Heavy per-file/chapter JSON blobs and
   the filesystem `path` are deliberately NOT in BOOK_SHAPE (see discovery.js) so they
   never leak into the list response either. */
const BOOK_COLUMNS = BOOK_SHAPE.map((f) => f.name);
const SELECT_SQL = `SELECT ${BOOK_COLUMNS.join(', ')} FROM books`;

/** genres is a JSON-array TEXT column (2.1); every other BOOK_SHAPE field is a plain
 *  SQLite scalar already JSON-ready as-is. */
function toRow(r) {
  return { ...r, genres: r.genres ? JSON.parse(r.genres) : [] };
}

/**
 * @param {{ db: import('better-sqlite3').Database }} deps
 */
function createBooksRouter({ db }) {
  const router = Router();

  router.get('/api/books', (req, res) => {
    try {
      const { where, params } = buildItemFilters(req.query, BOOKS_FILTER_SPEC);
      const sql = `${SELECT_SQL}${where ? ` WHERE ${where}` : ''} ORDER BY author ASC, series ASC, series_seq ASC, title ASC`;
      const rows = db.prepare(sql).all(...params);
      // Bare array, not { books } — the weave read contract (weaveClient.list /
      // useWeaveList coerce with Array.isArray; an enveloped list reads as empty).
      res.json(rows.map(toRow));
    } catch (err) {
      console.error(`[papyros] books list failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to list books' });
    }
  });

  return router;
}

module.exports = { createBooksRouter, BOOKS_FILTER_SPEC };
