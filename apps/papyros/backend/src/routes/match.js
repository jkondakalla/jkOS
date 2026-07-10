'use strict';
// routes/match.js — the `matchBook` capability (task 4.2): POST /api/match takes a
// bookId + one candidate row off GET /api/metadataSearch (4.1's META connector,
// discovery.js) and applies it to that book's `books` row. Factory style matches
// routes/library.js and routes/books.js — createMatchRouter takes its deps at the edge
// (db, dataDir, an injectable fetch) and server.js wires the real ones; this file never
// touches process.env or picks its own fetch implementation.
//
// `fetch` is an injectable seam (default globalThis.fetch, Node >=18) — same philosophy
// as @jkos/weave/server/connector.js's `opts.fetch` (META.mount already uses that seam
// for metadataSearch). 4.4's smoke hands a mock fetch that resolves a fake JPEG buffer
// for the upsized artwork URL, so the route's tests need no real network call.
//
// Task 4.3 adds `matchAllMissing` (POST /api/match/all, admin-only) in this same file —
// an admin sweep of every `metadata_source:'embedded'` book still missing author/cover
// that auto-applies ONLY conservative exact title+author matches and returns everything
// else as a review list. It shares 4.2's "write a candidate onto a book row" logic
// rather than re-deriving it: `applyCandidate()` below is that body, extracted verbatim
// (same statements, same best-effort-cover semantics) so POST /api/match's wire
// behavior is provably unchanged by this refactor — only ITS caller (the route handler)
// changed shape.

const fs = require('node:fs');
const path = require('node:path');
const { Router } = require('express');
const { CODES, authError } = require('@jkos/auth-middleware');   // 4.3's admin gate — same house pattern as routes/library.js
const { extractYear, cleanGenres } = require('../library/probe');   // same 4-digit-year convention scan.js's mapTagsToColumns uses

/** iTunes serves search-result artwork at `artworkUrl100` (a 100x100 thumbnail), but
 *  the SAME asset is addressable at other sizes by swapping that `100x100` path segment
 *  — 600x600 is the largest iTunes reliably serves for this artwork family without a
 *  separate per-title lookup, so it's the fixed upsize target the brief calls for. */
function upsizeArtwork(url) {
  return String(url).replace('100x100', '600x600');
}

/** Merge `genre` into the book's existing genres array — de-duped, existing genres kept
 *  first (same order-preserving convention as src/library/probe.js's parseGenres). A
 *  missing/malformed existing column (shouldn't happen — scan.js always writes valid
 *  JSON) falls back to an empty array rather than throwing. */
function mergeGenres(existingJson, genre) {
  let existing;
  try {
    existing = JSON.parse(existingJson || '[]');
  } catch {
    existing = [];
  }
  if (!Array.isArray(existing)) existing = [];
  if (!genre || existing.includes(genre)) return cleanGenres(existing);
  return cleanGenres([...existing, genre]);
}

/** Only accept an https:// artwork URL before ever fetching it. The brief allows either
 *  a host allowlist (mzstatic.com/apple.com) or the simpler https-only check — this
 *  route takes the simpler one: candidate.cover always comes from META's own iTunes
 *  proxy response (never arbitrary user input reflected back), so the URL is already
 *  upstream-controlled by the time it reaches here; the https check is just cheap
 *  defense against a malformed/empty string, not a security boundary. */
function isFetchableCoverUrl(url) {
  return typeof url === 'string' && url.startsWith('https://');
}

/** 4.3: applies ONE candidate row (META's `metadataSearch` shape) onto ONE `books` row —
 *  the exact body task 4.2 originally inlined into POST /api/match's handler, extracted
 *  so `matchAllMissing` (below) can reuse it verbatim instead of re-deriving the write
 *  set/artwork semantics a second time. Takes `db`/`dataDir`/`doFetch` as plain
 *  parameters (rather than closing over createMatchRouter's) so it's callable/testable
 *  on its own.
 *
 *  `book` only needs to carry `{ id, genres }` (mergeGenres reads `genres`, everything
 *  else is keyed by `id`) — both callers below pass a real `books` row that has more
 *  columns than that, which is fine, extra columns are ignored.
 *
 *  The metadata UPDATE is allowed to throw (a caller-visible failure — both routes
 *  catch it and turn it into their own error response/review entry). Artwork download
 *  stays best-effort INSIDE this function, exactly as 4.2 wrote it: a failed download
 *  never fails the match, it just leaves cover_path unchanged and reports cover:'failed'.
 *
 * @returns {Promise<{ cover: 'updated'|'failed' }>}
 */
async function applyCandidate(db, dataDir, doFetch, book, candidate) {
  // Prepared per call (this isn't a hot path — a single matchBook click, or one book
  // per ~250ms inside matchAllMissing's throttled sweep) rather than hoisted into
  // createMatchRouter's closure, so this function stays a plain (db, ...) => ... call
  // either route (or a future caller) can invoke without holding a router's statements.
  const updateMetaStmt = db.prepare(`
    UPDATE books SET
      author = @author,
      description = @description,
      year = @year,
      genres = @genres,
      metadata_source = 'itunes',
      ext_ref = @ext_ref
    WHERE id = @id
  `);
  const updateCoverStmt = db.prepare('UPDATE books SET cover_path = ? WHERE id = ?');

  // `title` is deliberately NOT in this SET: the scanner/user title wins over an iTunes
  // search result (candidates are frequently an abridged/re-titled edition), matching
  // the brief's "title is NOT overwritten" call. `series` is left untouched too — iTunes
  // audiobook candidates carry no series field at all (see discovery.js's META.item), so
  // there's nothing trustworthy to write; inventing one would be worse than leaving it
  // alone. Let a write failure propagate — the caller decides what that means for ITS
  // response shape (matchBook: 500; matchAllMissing: that book goes to review).
  updateMetaStmt.run({
    id: book.id,
    author: candidate.author ?? null,
    description: candidate.description ?? null,
    year: extractYear(candidate.year),
    genres: JSON.stringify(mergeGenres(book.genres, candidate.genre)),
    ext_ref: `itunes:${candidate.id}`,
  });

  // ── Artwork: best-effort, never fails the whole match ────────────────────────
  // A download failure (bad URL, upstream 4xx/5xx, network error) still leaves the
  // metadata write above intact — it just leaves cover_path unchanged and reports
  // cover:'failed' so the caller can surface that without the whole request erroring.
  let cover = 'failed';
  if (isFetchableCoverUrl(candidate.cover)) {
    try {
      const r = await doFetch(upsizeArtwork(candidate.cover));
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const coversDir = path.join(dataDir, 'covers');
      fs.mkdirSync(coversDir, { recursive: true });
      const dest = path.join(coversDir, `${book.id}.jpg`);
      fs.writeFileSync(dest, buf);
      // Same relative-to-dataDir form scan.js's extractCover() stores (e.g.
      // 'covers/12.jpg') — src/media.js resolves cover_path the same way regardless of
      // which writer produced it.
      updateCoverStmt.run(path.relative(dataDir, dest), book.id);
      cover = 'updated';
    } catch (err) {
      console.warn(`[papyros] applyCandidate artwork download failed for book ${book.id}: ${err.message}`);
    }
  }

  return { cover };
}

/* ── 4.3: matchAllMissing's conservative exact-match gate ─────────────────────────
   Manual-first is suite philosophy (ToDo §2, 4.3) — AI-assist via LazurOS is parked, so
   this stays deliberately dumb: case-fold + trim + collapse inner whitespace, NOTHING
   fuzzier (no Levenshtein/soundex/subset matching). A near-miss ("Foundation" vs
   "Foundation: A Novel", "J.R.R. Tolkien" vs "JRR Tolkien") is exactly the kind of call
   a human should make, not a heuristic — those land in the review list instead.

   The format-level allowances (verified against the real library + live iTunes,
   2026-07-09 — each is a fixed upstream formatting convention, not fuzzy matching):
   - a trailing "(Unabridged)"/"(Abridged)" parenthetical is stripped — iTunes titles
     virtually every audiobook "<Title> (Unabridged)" while embedded tags never do;
     without stripping it the exact matcher structurally failed on ~every candidate;
   - whitespace before punctuation is collapsed — iTunes emits "Breakneck : China's…"
     where tags say "Breakneck: China's…";
   - spaced ellipses are folded (". . ." / "…" → "...").
   Authors get two more (normalizeAuthors): "(translator)"-style parenthetical role
   annotations are dropped, and the list separator (", " vs " & " vs " and ") is
   canonicalized — the NAMES still have to match exactly, in order; a candidate listing
   fewer/other authors than the tags still goes to review. */
function normalizeForMatch(s) {
  return String(s == null ? '' : s)
    .trim()
    .replace(/\s*\((?:un)?abridged\)\s*$/i, '')
    .toLowerCase()
    .replace(/…/g, '...')
    .replace(/\.\s+\.\s+\./g, '...')
    .replace(/\s+([:;,.!?])/g, '$1')
    .replace(/\s+/g, ' ');
}

/** Author-list comparison form: normalizeForMatch plus role-annotation and separator
 *  canonicalization (see the comment block above for exactly what is allowed). */
function normalizeAuthors(s) {
  return normalizeForMatch(s)
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:,|&|\band\b)\s*/)
    .map((a) => a.trim())
    .filter(Boolean)
    .join(', ');
}

/** True only when `candidate`'s title AND author both normalize to the SAME string as
 *  `book`'s. A book with no author can NEVER return true here — there is no author to
 *  match against, so it always falls through to the review list even if a candidate's
 *  title looks like an exact hit (matchAllMissing's caller relies on this, but the
 *  check is repeated here too so this function is safe to call standalone). */
function isExactMatch(book, candidate) {
  const bAuthor = normalizeAuthors(book.author);
  if (!bAuthor) return false;   // no author on the book — nothing to match, always review
  const bTitle = normalizeForMatch(book.title);
  const cTitle = normalizeForMatch(candidate.title);
  const cAuthor = normalizeAuthors(candidate.author);
  if (!bTitle || !cTitle || !cAuthor) return false;
  return bTitle === cTitle && bAuthor === cAuthor;
}

/** Hand-rolled iTunes search + map for matchAllMissing's internal batch sweep.
 *
 *  This does NOT call through @jkos/weave/connector's META.mount() (discovery.js) —
 *  checked packages/weave/src/server/connector.js: `defineConnector(def).mount(router,
 *  opts)` only wires `reads`/`actions` onto Express routes; it exposes no standalone
 *  "fetch + map one term" function a route handler could call in-process (mount()'s
 *  closures — upstreamUrl/authParts/mapItem — aren't returned, only bound into the
 *  route it registers). So this function mirrors META's spec (discovery.js: same
 *  media/entity/limit query, same collectionId/collectionName/artistName/
 *  artworkUrl100/description/releaseDate/primaryGenreName → id/title/author/cover/
 *  description/year/genre map) rather than reusing it. META (discovery.js) stays the
 *  single SERVED wire contract for GET /api/metadataSearch — this is a second caller of
 *  the same upstream with the same shape, not a second contract to keep in sync by hand
 *  (both read off the one comment block in discovery.js documenting the field mapping).
 *
 * @returns {Promise<Array<{id:number, title:string, author:string, cover:string, description:string, year:string, genre:string}>>}
 */
async function searchItunesCandidates(doFetch, term) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('media', 'audiobook');
  url.searchParams.set('entity', 'audiobook');
  url.searchParams.set('limit', '5');
  url.searchParams.set('term', term);
  const r = await doFetch(url);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const data = await r.json();
  const rows = Array.isArray(data && data.results) ? data.results : [];
  return rows.map((rec) => ({
    id: rec.collectionId,
    title: rec.collectionName,
    author: rec.artistName,
    cover: rec.artworkUrl100,
    description: rec.description,
    year: rec.releaseDate,
    genre: rec.primaryGenreName,
  }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Knockoff/companion products that must NEVER auto-apply over the real book — the
 *  search term includes the author, but "Summary of …"-mill listings often rank above
 *  the real audiobook on iTunes. Filtered out of the auto-pick entirely; they still
 *  appear in the manual per-book candidate list (matchBook is the user's own click). */
function isKnockoff(candidate) {
  const t = String(candidate.title || '').trim();
  const a = String(candidate.author || '');
  return /^(a |the )?(summary|workbook|study guide|analysis|key takeaways|conversation starters)\b/i.test(t)
      || /\bsummar(y|ies)\b/i.test(a);
}

/** The enrichment sweep, extracted from POST /api/match/all so server.js can also run
 *  it automatically after every scan (PAPYROS_AUTO_ENRICH=1 — Jag 2026-07-10: "all
 *  books should be enriched by default as long as a match is found").
 *
 *  Apply policy (relaxed 2026-07-10 from exact-only, per that directive): knockoffs
 *  are filtered, then the FIRST of — exact title+author match → exact-author match →
 *  exact-or-subtitle-extension title match → the top remaining candidate — is applied.
 *  A book lands in `review` only when the search errored or returned nothing usable.
 *  `applied` rows carry `via` ('exact'|'author'|'title'|'first') so the UI/logs can
 *  show how confident each auto-match was.
 *
 * @returns {Promise<{examined:number, applied:Array, review:Array, truncated:boolean}>}
 */
async function runEnrichmentSweep({ db, dataDir, doFetch, cap = 50, delayMs = 250 }) {
  // Pool: every still-embedded book missing an author, a cover, OR a description
  // (description joined 2026-07-09 — embedded rips carry author+cover but never a
  // synopsis, so the original trigger was a no-op on a healthy library). Books already
  // enriched (metadata_source != 'embedded') are never re-touched.
  const pool = db.prepare(`
    SELECT id, title, author, genres FROM books
    WHERE metadata_source = 'embedded'
      AND (author IS NULL OR author = '' OR cover_path IS NULL
           OR description IS NULL OR description = '')
    ORDER BY id
  `).all();

  const truncated = pool.length > cap;
  const batch = pool.slice(0, cap);
  const applied = [];
  const review = [];

  for (let i = 0; i < batch.length; i++) {
    const book = batch[i];
    if (i > 0) await sleep(delayMs);   // sequential + throttled — polite to a keyless upstream

    let candidates;
    try {
      const term = [book.title, book.author].filter(Boolean).join(' ');
      candidates = await searchItunesCandidates(doFetch, term);
    } catch (err) {
      console.warn(`[papyros] enrichment search failed for book ${book.id}: ${err.message}`);
      review.push({ bookId: book.id, title: book.title, candidates: [], error: true });
      continue;
    }

    const usable = candidates.filter((c) => !isKnockoff(c));
    const exact = usable.find((c) => isExactMatch(book, c));
    const byAuthor = usable.find((c) => {
      const ba = normalizeAuthors(book.author);
      return ba && ba === normalizeAuthors(c.author);
    });
    const byTitle = usable.find((c) => {
      const bt = normalizeForMatch(book.title);
      const ct = normalizeForMatch(c.title);
      return bt && ct && (bt === ct || bt.startsWith(ct + ':') || ct.startsWith(bt + ':'));
    });
    const pick = exact || byAuthor || byTitle || usable[0] || null;
    const via = pick === exact ? 'exact' : pick === byAuthor ? 'author' : pick === byTitle ? 'title' : 'first';

    if (pick) {
      try {
        await applyCandidate(db, dataDir, doFetch, book, pick);
        applied.push({ bookId: book.id, title: book.title, extRef: `itunes:${pick.id}`, via });
      } catch (err) {
        console.error(`[papyros] enrichment apply failed for book ${book.id}: ${err.message}`);
        review.push({ bookId: book.id, title: book.title, candidates });
      }
    } else {
      review.push({ bookId: book.id, title: book.title, candidates });
    }
  }

  return { examined: batch.length, applied, review, truncated };
}

/**
 * @param {{ db: import('better-sqlite3').Database, dataDir: string, fetch?: typeof globalThis.fetch }} deps
 */
function createMatchRouter({ db, dataDir, fetch: injectedFetch }) {
  if (!db) throw new Error('createMatchRouter: db is required');
  if (!dataDir) throw new Error('createMatchRouter: dataDir is required');
  const doFetch = injectedFetch || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('createMatchRouter: no fetch available (pass opts.fetch)');

  const router = Router();

  const getBookStmt = db.prepare('SELECT id, genres FROM books WHERE id = ?');

  router.post('/api/match', async (req, res) => {
    const { bookId, candidate } = req.body || {};

    const id = Number(bookId);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const book = getBookStmt.get(id);
    if (!book) return res.status(404).json({ error: 'Not found' });

    if (!candidate || candidate.id == null) {
      return res.status(400).json({ error: 'candidate.id is required' });
    }

    let cover;
    try {
      ({ cover } = await applyCandidate(db, dataDir, doFetch, book, candidate));
    } catch (err) {
      console.error(`[papyros] matchBook metadata write failed for book ${id}: ${err.message}`);
      return res.status(500).json({ error: 'Match failed' });
    }

    res.json({ updated: true, cover });
  });

  // ── 4.3: matchAllMissing — POST /api/match/all, admin-only ─────────────────────
  // Same admin gate as routes/library.js's rescanLibrary (req.user.role === 'admin',
  // not a raw scope-array lookup) for the same reason documented there: weaveAuth's
  // documented dev fallback injects {sub, role:'admin'} with no scope array, and this
  // is the suite's existing admin-gate precedent (apps/lazuros/backend/routes/jobs.js).
  // The capability doc (discovery.js) still declares scopes:['papyros:admin'] — role
  // and scope agree for every real token, this check is just resilient to the dev stub.
  router.post('/api/match/all', async (req, res) => {
    if (req.user?.role !== 'admin') {
      return authError(res, 403, CODES.INSUFFICIENT_SCOPE, 'Insufficient scope', { required: ['papyros:admin'] });
    }
    // The whole sweep lives in runEnrichmentSweep (module level) so server.js can run
    // the identical policy automatically after every scan (PAPYROS_AUTO_ENRICH).
    res.json(await runEnrichmentSweep({ db, dataDir, doFetch }));
  });

  return router;
}

module.exports = { createMatchRouter, runEnrichmentSweep };
