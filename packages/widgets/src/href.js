// href.js — the one gate every widget href passes through.
//
// A widget's hrefs are data: `link.href` and `frame.href` are Bindings that resolve from
// a live row or from a spec an admin published, and Focus's deeplink comes from the
// shelf. React 18 renders a `javascript:` URL into an <a> with nothing but a dev-mode
// warning, so the renderer passes every resolved href through here, and the validator
// holds a literal href to the same rule: http(s), mailto and relative URLs survive; any
// other scheme (javascript:, data:, vbscript:, file:, …) becomes `undefined` — no link,
// rather than a live one.
//
// Parsed with the WHATWG URL parser — the browser's own algorithm — never a regex: it
// drops the tabs, newlines and leading control characters a browser drops, so
// `java\tscript:` is read here exactly as the browser would read it.

const ALLOWED = new Set(['http:', 'https:', 'mailto:'])
/** A relative href resolves against this and so reads as https: — it stays on the page's origin. */
const BASE = 'https://relative.invalid/'

export function safeHref(v) {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s) return undefined
  let url
  try { url = new URL(s, BASE) } catch { return undefined }
  return ALLOWED.has(url.protocol) ? s : undefined
}
