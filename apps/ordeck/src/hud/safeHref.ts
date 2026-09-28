/**
 * hud/safeHref.ts — the one gate every widget href passes through.
 *
 * A widget's hrefs are data: `link.href` and `frame.href` are Bindings that can resolve
 * from a live dataset row or from a spec an admin published, and Focus's deeplink comes
 * from the shelf. React 18 renders a `javascript:` URL into an <a> with nothing but a
 * dev-mode warning, so every resolved href is passed through here first: http(s),
 * mailto and relative URLs survive; any other scheme (javascript:, data:, vbscript:,
 * file:, …) becomes `undefined` — no link, rather than a live one.
 *
 * Parsed with the WHATWG URL parser — the browser's own algorithm — never a regex: it
 * drops the tabs, newlines and leading control characters a browser drops, so
 * `java\tscript:` is read here exactly as the browser would read it.
 */

const ALLOWED = new Set(['http:', 'https:', 'mailto:']);
/** A relative href resolves against this and so reads as https: — it stays on the page's origin. */
const BASE = 'https://relative.invalid/';

export function safeHref(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;
  let url: URL;
  try { url = new URL(s, BASE); } catch { return undefined; }
  return ALLOWED.has(url.protocol) ? s : undefined;
}
