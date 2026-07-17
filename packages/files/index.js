'use strict';
// @jkos/files — shared file-serving primitives for jkOS media backends.
//
// Lifted verbatim from PapyrOS backend/src/media.js (ToDo Section 3 Wave 17, 17.1): the
// Range-aware HTTP streaming implementation (there: sendFileRange) and the
// path-containment resolver (there: resolveContained) that every catalog-backed media
// backend needs — a scanner-written DB row still gets a defensive containment check on
// the path that actually reaches the filesystem, and a player's Range request still
// gets the exact 200/206/416 contract every real media server implements. PapyrOS is
// the first consumer (its media.js is now a thin caller); the parking-unblocked
// VaultOS music backend is the second, which is exactly the seam this package exists
// to prove. 17.3's defineMediaRoutes sits on top of this next — keep this surface
// generic, no app-specific naming (mime lookup, book/file id resolution, etc. all stay
// in the calling app).
//
// Plain CJS, no dual ESM twin: every current/expected consumer (papyros, the future
// music backend) is a plain-JS, no-bundler Node backend that already `require()`s
// @jkos/auth-middleware the same way — an .mjs twin (see @jkos/weave/server) earns its
// keep only once a `type:module` backend actually needs one, which costs nothing to add
// later and nothing to skip now.

const fs = require('node:fs');
const path = require('node:path');

/** Resolve `rel` against `root` and assert the result is still inside `root`. Callers
 *  that trust a scanner-written path (never user input) still get this defensively —
 *  a user-supplied index into that catalog (a bookId/fileIndex, a trackId, ...) IS
 *  attacker-reachable, so a containment check on the path that actually touches the
 *  filesystem costs nothing and turns any future catalog/row corruption into a loud
 *  404 instead of a silent escape outside the mount. Returns the resolved absolute
 *  path, or null on violation. */
function containPath(root, rel) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, rel);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) return null;
  return resolved;
}

/**
 * Serve `absPath` over `res` with full HTTP Range support — the one Range-aware
 * file-streaming implementation every jkOS media backend shares. Uses only the base
 * node:http ServerResponse surface (statusCode/setHeader/end/headersSent), so it works
 * against a plain http.createServer response exactly as well as an Express one.
 *
 * Handles:
 *   - no Range header                              -> 200, whole file
 *   - a satisfiable single-range "bytes=start-end" /
 *     "bytes=start-" / "bytes=-suffix"              -> 206, with Content-Range
 *   - anything else (malformed, multi-range,
 *     out-of-bounds)                                -> 416, with Content-Range: bytes * /total
 * Always sets Accept-Ranges: bytes and Content-Length. Streams via fs.createReadStream
 * (never buffers the whole file into memory), destroys the read stream if the client
 * disconnects mid-response, and reports a read-time error via opts.onError (defaults to
 * a console.error) before ending the response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {string} absPath - already-resolved, already-verified-safe absolute path
 * @param {{
 *   range?: string,
 *   contentType: string,
 *   stat?: import('node:fs').Stats,
 *   onError?: (err: Error) => void,
 * }} opts
 *   - range: the raw `Range` request header value, if any (omitted/undefined = whole file)
 *   - contentType: the Content-Type header value to send
 *   - stat: a pre-fetched fs.Stats for absPath (skips a redundant stat when the caller
 *     already needed the size for something else, e.g. a freshness check); statSync'd
 *     internally when omitted
 *   - onError: called with the read-stream error instead of the default console.error
 */
function rangeStream(res, absPath, opts = {}) {
  const { range: rangeHeader, contentType, onError } = opts;
  const stat = opts.stat || fs.statSync(absPath);
  const total = stat.size;

  let start = 0;
  let end = total - 1;
  let status = 200;

  if (rangeHeader) {
    // Only the single-range "bytes=start-end" / "bytes=start-" / "bytes=-suffix" forms
    // are handled — multi-range ("bytes=0-1,10-20") is not a real media-player use case
    // and falls through to the unsatisfiable branch below.
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      res.setHeader('Content-Range', `bytes */${total}`);
      res.statusCode = 416;
      res.end();
      return;
    }
    if (m[1] === '') {
      // Suffix range: "bytes=-500" → last 500 bytes.
      const suffixLen = Number.parseInt(m[2], 10);
      start = Math.max(0, total - suffixLen);
      end = total - 1;
    } else {
      start = Number.parseInt(m[1], 10);
      end = m[2] === '' ? total - 1 : Number.parseInt(m[2], 10);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      res.setHeader('Content-Range', `bytes */${total}`);
      res.statusCode = 416;
      res.end();
      return;
    }
    end = Math.min(end, total - 1);
    status = 206;
  }

  res.statusCode = status;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(end - start + 1));
  if (status === 206) res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);

  const stream = fs.createReadStream(absPath, { start, end });
  // Guard against a leaked fd if the client disconnects mid-stream (a scrub/seek that
  // abandons the in-flight request is the common case for a Range-served player).
  res.on('close', () => { stream.destroy(); });
  stream.on('error', (err) => {
    if (onError) onError(err);
    else console.error(`[@jkos/files] stream read failed for "${absPath}": ${err.message}`);
    stream.destroy();
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
    else res.end();
  });
  stream.pipe(res);
}

module.exports = { containPath, rangeStream };
