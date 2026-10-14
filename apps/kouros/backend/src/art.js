'use strict';
// art.js — where a cover is loaded from, as a URL anything in the suite can use.
//
// The art routes are this app's (`/api/cover/:id`, `/api/books/cover/:id`), and every
// suite origin reaches them at the EDGE path `/api/kouros/…` (infra/nginx: every origin
// includes the weave proxy). So a reader that is not this app's own frontend — an ORDECK
// widget, a KourOS page drawn by the widget renderer — is handed that path, ready to load,
// rather than an id it would have to know how to turn into one. A widget binds values; it
// never builds them.

const { APPS, apiBaseOf } = require('@jkos/suite-manifest');

const API_BASE = apiBaseOf(APPS.find((a) => a.id === 'kouros'));

/** A track's art, or null when it has none. */
function trackCoverUrl(id, has = true) {
  return has && id != null ? `${API_BASE}/cover/${id}` : null;
}

/** An audiobook's jacket, or null when it has none. */
function bookCoverUrl(id, has = true) {
  return has && id != null ? `${API_BASE}/books/cover/${id}` : null;
}

module.exports = { trackCoverUrl, bookCoverUrl, API_BASE };
