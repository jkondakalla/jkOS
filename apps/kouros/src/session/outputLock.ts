// session/outputLock.ts — which TAB of this browser is allowed to make sound.
//
// Every tab of one browser shares one device id (session/device.ts), so when the
// session's output is "this device", something has to say which tab plays — or two
// tabs each hear the `play` command and the listener gets the song twice, a beat
// apart. A Web Lock is that something: exactly one tab holds `kouros.output`, the
// lock outlives no tab (a closed or crashed tab releases it), and a tab that is told
// to play by a USER GESTURE takes it with `steal` — the tab you touch plays, and the
// one that had it hears its lock rejected and stops.
//
// Without Web Locks (a very old browser) there is no way to coordinate tabs, and
// every tab behaves as though it holds the lock: correct for the one-tab case,
// which is the only one such a browser can be expected to handle.

const NAME = 'kouros.output';

type Listener = (held: boolean) => void;
const listeners = new Set<Listener>();
let held = false;
let release: (() => void) | null = null;
/** The claim in flight, if any — shared by a second non-stealing claim (below). */
let pending: Promise<boolean> | null = null;

const locks = (): LockManager | null =>
  typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;

function set(next: boolean) {
  if (held === next) return;
  held = next;
  for (const l of listeners) l(held);
}

/** Does THIS tab hold the output lock? */
export function holdsOutputLock(): boolean {
  return locks() ? held : true;
}

/** Does ANOTHER tab of this browser hold it? */
export async function outputLockedElsewhere(): Promise<boolean> {
  const lm = locks();
  if (!lm || held) return false;
  try {
    const q = await lm.query();
    return (q.held || []).some((l) => l.name === NAME);
  } catch {
    return false;
  }
}

/**
 * Take the lock. `steal` is for a user gesture on THIS tab (they pressed play here,
 * so here plays, whichever tab had it); without it the lock is taken only if no tab
 * holds it — a takeover from another device lands on every tab of this one, and the
 * tab that already plays should keep playing rather than the last to hear it winning.
 * Resolves true when this tab holds it.
 */
export function claimOutputLock({ steal = false }: { steal?: boolean } = {}): Promise<boolean> {
  const lm = locks();
  if (!lm) return Promise.resolve(true);
  if (held) return Promise.resolve(true);
  // Two claims in one tick (a takeover, and the effect that sees the session name
  // this device) share one request — a second would only ever lose to the first.
  if (pending && !steal) return pending;
  const attempt = new Promise<boolean>((resolve) => {
    let mine = false;
    lm.request(NAME, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return undefined; }   // ifAvailable, and another tab has it
      mine = true;
      set(true);
      resolve(true);
      // Held until released here — or stolen, which rejects the request below.
      return new Promise<void>((r) => { release = r; });
    })
      .catch(() => { /* stolen by another tab (AbortError) — the finally says so */ })
      .finally(() => {
        // ⚠️ Only the request that HELD the lock may say it is gone. A losing
        // ifAvailable request ends here too, and clearing on its way out marked a
        // tab that still held the lock as not holding it — which then read its own
        // lock as "another tab's", decided it was a remote, and paused itself.
        if (mine) { release = null; set(false); }
        resolve(false);   // a no-op if it already resolved true
      });
  });
  pending = attempt;
  void attempt.finally(() => { if (pending === attempt) pending = null; });
  return attempt;
}

/**
 * Queue for the lock and take it the moment the tab holding it lets go — closes,
 * crashes, or releases it. For a tab whose DEVICE is the output while another of its
 * tabs plays: when that tab goes, this one must become the device's voice (report
 * it paused, take its commands), and Web Locks has no "released" event to hear — a
 * queued request IS that event. `signal` withdraws from the queue (the session moved
 * to another device, so there is nothing to inherit).
 */
export function awaitOutputLock(signal: AbortSignal): void {
  const lm = locks();
  if (!lm || held) return;
  let mine = false;
  lm.request(NAME, { signal }, () => {
    mine = true;
    set(true);
    return new Promise<void>((r) => { release = r; });
  })
    .catch(() => { /* withdrawn (AbortError), or stolen after it was granted */ })
    .finally(() => { if (mine) { release = null; set(false); } });
}

/** Give the lock up (this tab stopped being the output). */
export function releaseOutputLock(): void {
  release?.();
}

/** Hear this tab gain or lose the lock — losing it to a steal is how a tab learns
 *  another tab of the browser took over. Returns the unsubscribe function. */
export function onOutputLock(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
