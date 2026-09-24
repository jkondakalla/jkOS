'use strict';
// discover/recent.js — "Recently played" and "Continue listening", the two Home rails
// that read a listener's own ledgers rather than the vector space.
//
// RECENTLY PLAYED is by CONTEXT, not by track (Jag, 2026-09-23: albums, playlists,
// artists, stations — Spotify's shape): one tile per place you played from, newest
// first, each a link to that place. Track listens carry their context in
// `history.context` (src/playContext.js for the grammar); every book listen IS its
// book, so `book_history` needs no column — the two ledgers merge here.
//
// CONTINUE LISTENING is audiobooks only (Jag: long-term resume is for books; music
// needs none) — every unfinished book with a saved position, most recently touched
// first. The shared listening session is shown separately (Home's NowCard).
//
// Plain SQL, not the vector space: a recently-played rail must not go blank because
// the embedder's index is absent. ⚠️ Refs are TEXT-affinity (TRAPS.md § SQLite), so
// every join CASTs.

const { parsePlayContext } = require('../playContext');

/** Newest-first distinct contexts across both ledgers, resolved to tiles. */
function recentContexts(db, userId, { k = 14 } = {}) {
  if (userId == null) return [];
  const over = k * 3;   // a context whose row has vanished is skipped, so over-fetch
  const tracks = db.prepare(`
    SELECT context, MAX(started_at) AS at FROM history
     WHERE user_id = ? AND context IS NOT NULL
     GROUP BY context ORDER BY at DESC LIMIT ?`).all(userId, over);
  const books = db.prepare(`
    SELECT CAST(item_ref AS INTEGER) AS id, MAX(started_at) AS at FROM book_history
     WHERE user_id = ?
     GROUP BY CAST(item_ref AS INTEGER) ORDER BY at DESC LIMIT ?`).all(userId, over);

  const merged = [
    ...tracks.map((r) => ({ ctx: r.context, at: r.at })),
    ...books.map((r) => ({ ctx: `book/${r.id}`, at: r.at })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const out = [];
  const seen = new Set();
  for (const { ctx, at } of merged) {
    if (out.length >= k) break;
    if (seen.has(ctx)) continue;
    seen.add(ctx);
    const tile = resolve(db, userId, ctx);
    if (tile) out.push({ ...tile, route: ctx, played_at: at });
  }
  return out;
}

const ALBUM_ARTIST = 'COALESCE(albumartist, artist)';

function resolve(db, userId, ctx) {
  const c = parsePlayContext(ctx);
  if (!c) return null;
  switch (c.kind) {
    case 'album': {
      const r = db.prepare(`SELECT COUNT(*) AS n, MIN(CASE WHEN cover_path IS NOT NULL THEN id END) AS cover
        FROM tracks WHERE album = ? AND ${ALBUM_ARTIST} = ?`).get(c.album, c.artist);
      return r.n ? { kind: 'album', title: c.album, subtitle: c.artist, cover: coverOf('track', r.cover) } : null;
    }
    case 'artist': {
      const r = db.prepare(`SELECT COUNT(*) AS n, MIN(CASE WHEN cover_path IS NOT NULL THEN id END) AS cover
        FROM tracks WHERE ${ALBUM_ARTIST} = ? OR artist = ?`).get(c.artist, c.artist);
      return r.n ? { kind: 'artist', title: c.artist, subtitle: 'Artist', cover: coverOf('track', r.cover) } : null;
    }
    case 'playlist': {
      // Owner-scoped: a context is the listener's own row, but the playlist it names
      // must be THEIRS too — never a label read off someone else's.
      const p = db.prepare('SELECT name, track_refs FROM playlists WHERE id = ? AND user_id = ?').get(c.id, userId);
      if (!p) return null;
      let ids = [];
      try { ids = JSON.parse(p.track_refs || '[]').map(Number).filter(Number.isFinite).slice(0, 50); } catch { /* none */ }
      const cover = ids.length
        ? db.prepare(`SELECT id FROM tracks WHERE id IN (${ids.map(() => '?').join(',')}) AND cover_path IS NOT NULL LIMIT 1`).get(...ids)
        : null;
      return { kind: 'playlist', title: p.name, subtitle: 'Playlist', cover: coverOf('track', cover && cover.id) };
    }
    case 'station': {
      const t = db.prepare('SELECT id, title, artist, cover_path FROM tracks WHERE id = ?').get(c.id);
      return t
        ? { kind: 'station', title: t.title, subtitle: `Station · ${t.artist || 'Unknown artist'}`, seed: t.id, cover: coverOf('track', t.cover_path ? t.id : null) }
        : null;
    }
    case 'book': {
      const b = db.prepare('SELECT id, title, author, cover_path FROM books WHERE id = ?').get(c.id);
      return b
        ? { kind: 'book', title: b.title, subtitle: b.author || 'Audiobook', cover: coverOf('book', b.cover_path ? b.id : null) }
        : null;
    }
    default:
      return null;
  }
}

function coverOf(kind, id) {
  return id != null ? { kind, id } : null;
}

/** Unfinished audiobooks with a saved position, most recently touched first. */
function continueBooks(db, userId, { k = 12 } = {}) {
  if (userId == null) return [];
  return db.prepare(`
    SELECT b.id, b.title, b.author, b.cover_path IS NOT NULL AS has_cover, b.duration,
           p.position, COALESCE(p.last_played, p.updated_at) AS played_at
      FROM progress p
      JOIN books b ON b.id = CAST(p.book_ref AS INTEGER)
     WHERE p.user_id = ? AND p.finished = 0 AND p.position > 0
     ORDER BY p.updated_at DESC
     LIMIT ?`).all(userId, k).map((r) => ({ ...r, has_cover: !!r.has_cover }));
}

module.exports = { recentContexts, continueBooks };
