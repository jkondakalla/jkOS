// session/sse.ts — the listening session's wire, parsed. PURE: no fetch, no DOM, no
// timers — test/session-client.mjs drives it directly.
//
// The stream is read with fetch + a ReadableStream rather than EventSource, because
// EventSource cannot see a status code: a 401 TOKEN_EXPIRED on open is invisible to
// it, so it could never go through authFetch's refresh (and would reconnect into the
// same 401 for ever — jkDeploy's "reconnects drained the /auth/refresh rate limit"
// trap). The price of fetch is parsing the text/event-stream framing ourselves, here.

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Split a buffer of text/event-stream into whole events, returning what is left over
 * for the next chunk. The framing (WHATWG HTML §9.2): events are separated by a blank
 * line; `event:` names one, `data:` lines join with '\n'; a line starting ':' is a
 * comment (the server's keep-alive ping); one space after the colon is dropped. An
 * event with no data is not dispatched.
 *
 * ⚠️ A chunk can end between the '\r' and '\n' of a CRLF. Normalising that chunk
 * alone turns its '\r' into '\n' and the next chunk's '\n' into a SECOND one — a
 * phantom blank line that ends an event early. So a trailing '\r' is held back
 * unnormalised until the next chunk arrives.
 */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const hold = buffer.endsWith('\r') ? '\r' : '';
  const text = (hold ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n');
  const events: SseEvent[] = [];
  let start = 0;
  for (;;) {
    const end = text.indexOf('\n\n', start);
    if (end < 0) break;
    const block = text.slice(start, end);
    start = end + 2;
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest: text.slice(start) + hold };
}

/** How long to wait before reconnect attempt `attempt` (0-based): 3 s doubling to a
 *  30 s ceiling, ±20 % jitter — jkDeploy's numbers, so a server restart does not
 *  have every device of every listener reconnect in the same instant. `rand` is
 *  injected so the test can pin it. */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000, 3_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + 0.4 * rand()));
}
