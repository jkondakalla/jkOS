// player/context.ts — WHERE a queue was played FROM, as one string.
//
// A play context is the KourOS ROUTE of the album, playlist, artist, station or book
// a queue came from — the hash path minus its `#/`, built by the same link builders
// the views use, so a context and a link can never disagree and a "Recently played"
// tile is a link to its own page for free. The server holds the same grammar
// (backend/src/playContext.js) and refuses anything else at the door.
//
// An ad-hoc list — search results, a vibe-map region, a Run, the time-of-day rail —
// passes NO context: "search results for 'dua'" is not a place you go back to.

import { albumHref, artistHref, bookHref, playlistHref } from '../hooks/useHashRoute';

export type PlayContext = string;

const route = (href: string): PlayContext => href.replace(/^#\//, '');

export const albumContext = (artist: string, album: string): PlayContext => route(albumHref(artist, album));
export const artistContext = (artist: string): PlayContext => route(artistHref(artist));
export const playlistContext = (id: number): PlayContext => route(playlistHref(id));
export const bookContext = (id: number): PlayContext => route(bookHref(id));
/** A station has no page; its context names the seed, so a tile can replay it. */
export const stationContext = (seedId: number): PlayContext => `station/${seedId}`;
