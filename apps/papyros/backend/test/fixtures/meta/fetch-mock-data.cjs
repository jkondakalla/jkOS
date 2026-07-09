'use strict';
// fetch-mock-data.cjs (task 4.4) — the canned iTunes payload + fake artwork bytes shared
// between fetch-mock-preload.cjs (which serves them to the REAL server process, replacing
// globalThis.fetch before server.js ever loads) and meta.smoke.mjs (which asserts against
// the SAME literals from the OUTSIDE, over real HTTP, in a separate process). One source
// required by both — a hand-copied second literal in the test would silently drift from
// what the preload actually serves and the assertions would stop meaning anything.

// One iTunes search result carrying every field discovery.js's META.reads[0].map reads
// (collectionId/collectionName/artistName/artworkUrl100/description/releaseDate/
// primaryGenreName) so meta.smoke can assert EVERY mapped field, not just a couple.
// artworkUrl100 deliberately carries the literal '100x100' segment src/routes/match.js's
// upsizeArtwork() swaps for '600x600' — fetch-mock-preload.cjs's artwork route matches on
// that swapped form, so this is also what proves the upsize actually happened.
const ITUNES_ITEM = {
  collectionId: 918283746,
  collectionName: 'The Canned Chronicles',
  artistName: 'Fixture Author',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/canned/100x100bb.jpg',
  description: 'A canned iTunes audiobook description, for smoke-test mapping only.',
  releaseDate: '2019-03-14T00:00:00Z',
  primaryGenreName: 'Science Fiction',
};

// The exact upstream envelope shape META's `collection: 'results'` digs into.
const ITUNES_PAYLOAD = { resultCount: 1, results: [ITUNES_ITEM] };

// A marker string standing in for artwork bytes — NOT a real image, just fixed content
// meta.smoke can assert byte-for-byte against the cover file applyCandidate() (src/routes/
// match.js) writes to disk under the temp data dir.
const FAKE_JPEG_MARKER = 'FAKE-JPEG-BYTES-4.4-meta.smoke-v1';

module.exports = { ITUNES_ITEM, ITUNES_PAYLOAD, FAKE_JPEG_MARKER };
