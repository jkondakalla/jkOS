'use strict';
// src/playContext.js — WHERE a listen was played FROM, as one string.
//
// A play context is the KourOS ROUTE of the thing the queue came from — the very path
// its page lives at — so a "Recently played" tile is a link to that page by
// construction, and one grammar serves the history ledger, the listening session
// and the frontend's router:
//
//   album/<artist>/<album>     both segments encodeURIComponent'd (a name may hold '/')
//   playlist/<id>
//   artist/<artist>
//   station/<seed track id>    radio — the one context with no page; a tile replays it
//   book/<id>
//
// An ad-hoc list — search results, a vibe-map region, a Run — has NO context, and a
// listen from one is simply not a "recently played" tile. That is deliberate: Spotify
// shows where you played FROM, and "search results for 'dua'" is not a place.
//
// ⚠️ Parsed defensively and VALIDATED AT THE DOOR (server.js guards POST /api/history
// with `isPlayContext`): the string is client-supplied, and defineCollection has no
// per-field pattern or length check of its own.

const MAX_LEN = 600;
const ID = /^\d{1,12}$/;

/** Split a context into its parts, or null when it is not one. PURE. */
function parsePlayContext(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LEN) return null;
  const parts = raw.split('/');
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return null; } };
  switch (parts[0]) {
    case 'album': {
      if (parts.length !== 3) return null;
      const artist = dec(parts[1]); const album = dec(parts[2]);
      return artist && album ? { kind: 'album', artist, album } : null;
    }
    case 'artist': {
      if (parts.length !== 2) return null;
      const artist = dec(parts[1]);
      return artist ? { kind: 'artist', artist } : null;
    }
    case 'playlist': case 'station': case 'book':
      return parts.length === 2 && ID.test(parts[1]) ? { kind: parts[0], id: Number(parts[1]) } : null;
    default:
      return null;
  }
}

const isPlayContext = (raw) => parsePlayContext(raw) != null;

module.exports = { parsePlayContext, isPlayContext, PLAY_CONTEXT_MAX: MAX_LEN };
