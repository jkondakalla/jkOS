'use strict';
// routes/browse.js — server-side ALBUM and ARTIST browsing.
//
// Why this exists at all: every KourOS view up to now derived its albums and
// artists by fetching the ENTIRE `tracks` catalog and grouping it in the browser
// (views/library/format.ts's groupTracksByArtist). At the 875 tracks that were
// scanned while this was written that is merely wasteful. At the several
// thousand albums the brief targets it is a multi-megabyte JSON payload and a
// full re-group on every mount, on a phone, before anything paints.
//
// SQLite already has the grouping; it should do it. These routes return album and
// artist SUMMARIES (one row per record, not per track), paged, with the track
// list fetched only when a detail page actually opens.
//
// Album identity is (album, albumartist-or-artist) — matching src/discover/space.js's
// albumKeyOf — so two different records both called "Greatest Hits" stay apart.
const { Router } = require('express');

/** COALESCE(albumartist, artist) is the album's owning artist: a compilation
 *  tags each track with its own performer but shares one album artist, and
 *  grouping on `artist` would shatter it into one "album" per guest. */
const ALBUM_ARTIST = 'COALESCE(NULLIF(albumartist, \'\'), artist)';

const ALBUM_SELECT = `
  SELECT album,
         ${ALBUM_ARTIST}          AS artist,
         MAX(year)                AS year,
         COUNT(*)                 AS tracks,
         SUM(duration)            AS duration,
         MAX(updated_at)          AS added,
         MIN(id)                  AS anchor_id,
         MAX(CASE WHEN cover_path IS NOT NULL THEN id END) AS cover_id
    FROM tracks
   WHERE album IS NOT NULL AND album <> ''
`;

/* ⚠️ THE SUITE'S ONE PAGING CONTRACT (WEAVE.md §3.2). This file used to hold TWO
   hand-rolled clamps that disagreed with each other — (120, 600) and (300, 2000) —
   and jkAuth held a third. Three conventions is not a style problem: it is what makes
   a cross-app fan-out unmergeable, because "give me 100" means three different
   windows and a merged page comes back silently short.
   `pageLimit` caps at PAGE_MAX (500). An app may NARROW that where its rows are
   expensive; it may not widen it — so the old 600/2000 ceilings are gone. Safe here:
   the browse UI pages at 120 (src/views/Browse.tsx), a long way under the cap.

   ⚠️ `offset` REMAINS in this file, and the ruling says the suite has none — see the
   note at /api/albums for why that is a deliberate, bounded exception rather than an
   oversight. */
const { pageLimit } = require('@jkos/weave/activity');

function clampLimit(v, dflt) {
  return pageLimit(v, { fallback: dflt });
}

function createBrowseRouter({ db }) {
  const router = Router();

  /* ── Albums ────────────────────────────────────────────────────────────────
     `sort`: added (default) | title | artist | year. `q` is a substring match on
     album OR artist — a LIKE with a leading wildcard, which cannot use an index,
     but over a grouped catalog of this size it is a single fast scan and it is
     what a person means by "search". */
  router.get('/api/albums', (req, res) => {
    try {
      const limit = clampLimit(req.query.limit, 120);
      /* ⚠️ OFFSET, WHICH THE SUITE'S PAGING RULING FORBIDS (WEAVE.md §3.2) — kept here
         deliberately and bounded, not overlooked.
         The ruling's reason is that an offset is unstable under CONCURRENT WRITES:
         insert a row mid-page and the caller skips one or sees one twice, silently.
         That reason is about a delta feed over rows a user is actively editing. This
         is a GROUPED BROWSE over a music catalog that changes only on a rescan, with
         a stable ORDER BY — so the instability window is "during a library scan", and
         the alternative is designing a cursor for grouped-by-album results, which is
         a real piece of work and not this one.
         ⚠️ The moment this catalog gains incremental writes (a user-editable tag, a
         per-track rating that reorders), this becomes the bug the ruling describes.
         Recorded in Documentation/TODO.md rather than left as a comment nobody tracks. */
      const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
      const params = [];
      let where = '';
      if (req.query.q) {
        where = ` AND (album LIKE ? OR ${ALBUM_ARTIST} LIKE ?)`;
        params.push(`%${req.query.q}%`, `%${req.query.q}%`);
      }
      if (req.query.artist) {
        where += ` AND ${ALBUM_ARTIST} = ?`;
        params.push(req.query.artist);
      }
      const order = {
        title:  'album COLLATE NOCASE ASC',
        artist: `${ALBUM_ARTIST} COLLATE NOCASE ASC, year ASC`,
        year:   'year DESC, album COLLATE NOCASE ASC',
        added:  'added DESC',
      }[req.query.sort] || 'added DESC';

      const rows = db.prepare(`
        ${ALBUM_SELECT} ${where}
        GROUP BY album, ${ALBUM_ARTIST}
        ORDER BY ${order}
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      res.json(rows.map((r) => ({
        album: r.album,
        artist: r.artist,
        year: r.year || null,
        tracks: r.tracks,
        duration: Math.round(r.duration || 0),
        added: r.added,
        anchor_id: r.anchor_id,
        cover_id: r.cover_id,
      })));
    } catch (err) {
      console.error(`[kouros] albums list failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to list albums' });
    }
  });

  /* One album's tracks, in disc/track order. */
  router.get('/api/albums/tracks', (req, res) => {
    try {
      const { album, artist } = req.query;
      if (!album) return res.status(400).json({ error: 'album is required' });
      const params = [album];
      let sql = `
        SELECT id, title, artist, album, albumartist, track_no, disc_no, year, genres,
               duration, cover_path, updated_at
          FROM tracks
         WHERE album = ?`;
      if (artist) { sql += ` AND ${ALBUM_ARTIST} = ?`; params.push(artist); }
      sql += ' ORDER BY disc_no ASC, track_no ASC, title ASC';
      const rows = db.prepare(sql).all(...params);
      res.json(rows.map((r) => ({ ...r, genres: r.genres ? JSON.parse(r.genres) : [] })));
    } catch (err) {
      console.error(`[kouros] album tracks failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to load album' });
    }
  });

  /* ── Artists ──────────────────────────────────────────────────────────────── */
  router.get('/api/artists', (req, res) => {
    try {
      const limit = clampLimit(req.query.limit, 300);
      const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
      const params = [];
      let where = '';
      if (req.query.q) { where = ` AND ${ALBUM_ARTIST} LIKE ?`; params.push(`%${req.query.q}%`); }

      const rows = db.prepare(`
        SELECT ${ALBUM_ARTIST} AS artist,
               COUNT(*)        AS tracks,
               COUNT(DISTINCT album) AS albums,
               SUM(duration)   AS duration,
               MAX(CASE WHEN cover_path IS NOT NULL THEN id END) AS cover_id
          FROM tracks
         WHERE ${ALBUM_ARTIST} IS NOT NULL AND ${ALBUM_ARTIST} <> '' ${where}
         GROUP BY ${ALBUM_ARTIST}
         ORDER BY ${req.query.sort === 'size' ? 'tracks DESC' : 'artist COLLATE NOCASE ASC'}
         LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      res.json(rows.map((r) => ({
        artist: r.artist,
        tracks: r.tracks,
        albums: r.albums,
        duration: Math.round(r.duration || 0),
        cover_id: r.cover_id,
      })));
    } catch (err) {
      console.error(`[kouros] artists list failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to list artists' });
    }
  });

  /* ── Catalog counts — the library's own size, for the browse header ───────── */
  router.get('/api/library/stats', (_req, res) => {
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS tracks,
               COUNT(DISTINCT album) AS albums,
               COUNT(DISTINCT ${ALBUM_ARTIST}) AS artists,
               SUM(duration) AS duration
          FROM tracks
      `).get();
      res.json({
        tracks: row.tracks || 0,
        albums: row.albums || 0,
        artists: row.artists || 0,
        duration: Math.round(row.duration || 0),
      });
    } catch (err) {
      console.error(`[kouros] library stats failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to read library stats' });
    }
  });

  return router;
}

module.exports = { createBrowseRouter, ALBUM_ARTIST };
