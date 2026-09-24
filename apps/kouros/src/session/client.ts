// session/client.ts — this tab's connection to the listening session: one module-level
// store (like controller.ts's seams — there is one per tab, whoever renders).
//
// It registers the device, holds the live stream open for as long as the tab lives,
// keeps the latest snapshot (session, devices, the server clock), and exposes the
// write doors. It knows nothing about players: session/usePlayerSession.ts decides
// what a snapshot MEANS for this tab's engine.
//
// The stream (backend/src/session/routes.js): `hello` (a full snapshot), `session`
// (every new rev), `devices` (presence, names, volumes), `command` (only to the
// output), and `reauth` — the server closes a stream at its token's exp rather than
// let it outlive the credential. Every reconnect starts from a `hello` snapshot, not
// a replay: the session is one small document, and a replay could only ever be a
// slower way of arriving at it.
//
// ⚠️ The stream goes through authFetch, not EventSource. EventSource cannot see a
// 401, so an expired token would reconnect into the same 401 for ever; authFetch's
// refreshOnce() refreshes the cookie first, and dedupes it, so a room of devices
// reconnecting at once does not drain jkAuth's /auth/refresh rate limit (jkDeploy
// learned that one the hard way).

import { authFetch } from '@jkos/auth-client';
import type { Queue } from '@jkos/player/core';
import { backoffMs, parseSse } from './sse';
import { betterClock, sampleClock, type ClockSample } from './clock';
import { deviceIdentity, type DeviceIdentity } from './device';

const API = (import.meta as any).env?.VITE_API_URL ?? '';

/** The server's `toSession()` (backend/src/session/store.js), as it arrives. */
export interface ListeningSession {
  rev: number;
  active_device: string | null;
  queue: Queue;
  context: string | null;
  item_ref: string | null;
  position_ms: number;
  playing: boolean;
  rate: number;
  sleep_mode: string | null;
  sleep_remaining_ms: number | null;
  reported_at: string | null;
  /** The output's last error, e.g. 'autoplay-blocked' — carried on that one event. */
  error?: string;
}

export interface SessionDevice {
  id: string;
  name: string;
  kind: 'desktop' | 'phone' | 'tablet' | 'speaker';
  platform: string | null;
  volume: number | null;
  muted: boolean;
  last_seen_at: string;
  online: boolean;
}

/** What arrives at the output. `from` is null for the server's own (takeover, release). */
export interface SessionCommand {
  id: string;
  from: string | null;
  op: string;
  args: any;
}

/** starting → live ⇄ reconnecting; `unavailable` is for good (solo — see route.ts). */
export type SessionStatus = 'starting' | 'live' | 'reconnecting' | 'unavailable';

export interface SessionSnapshot {
  status: SessionStatus;
  session: ListeningSession | null;
  devices: SessionDevice[];
  me: DeviceIdentity;
  clock: ClockSample | null;
}

/* ── The store ──────────────────────────────────────────────────────────────────── */

let snap: SessionSnapshot | null = null;
const subs = new Set<() => void>();
const commandListeners = new Set<(c: SessionCommand) => void>();

function current(): SessionSnapshot {
  if (!snap) snap = { status: 'starting', session: null, devices: [], me: deviceIdentity(), clock: null };
  return snap;
}

function emit(patch: Partial<SessionSnapshot>) {
  snap = { ...current(), ...patch };
  for (const f of subs) f();
}

/** A session only ever moves FORWARD: a stale GET answered after a newer event must
 *  not roll the display back a rev. */
function applySession(s: ListeningSession | null | undefined) {
  if (!s) return;
  const have = current().session;
  if (!have || s.rev >= have.rev) emit({ session: s });
}

export function getSessionSnapshot(): SessionSnapshot { return current(); }

export function subscribeSession(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** Hear a command addressed to this device. Returns the unsubscribe function. */
export function onSessionCommand(l: (c: SessionCommand) => void): () => void {
  commandListeners.add(l);
  return () => { commandListeners.delete(l); };
}

/** The server's clock, as best this tab knows it. */
export function serverNow(): number {
  return Date.now() + (current().clock?.offsetMs ?? 0);
}

/* ── HTTP ───────────────────────────────────────────────────────────────────────── */

interface Reply<T = any> { status: number; ok: boolean; body: T | null }

async function call<T = any>(method: string, path: string, body?: unknown, extra: RequestInit = {}): Promise<Reply<T>> {
  const r = await authFetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...extra,
  });
  let json: T | null = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, ok: r.ok, body: json };
}

/** A clock sample off one GET — and the snapshot it carries, which is fresh too. */
async function sampleSnapshot(): Promise<void> {
  const sentAt = Date.now();
  try {
    const r = await call<{ session: ListeningSession; devices: SessionDevice[]; serverNow: string }>('GET', '/api/session', undefined, { cache: 'no-store' });
    const receivedAt = Date.now();
    if (!r.ok || !r.body) return;
    const sample = sampleClock(sentAt, receivedAt, r.body.serverNow);
    const have = current().clock;
    // The shortest round trip wins — until it is old: a sample from an hour ago on a
    // laptop that has since slept is not better, just earlier.
    const stale = have && Date.now() - clockTakenAt > 15 * 60_000;
    if (sample && (stale || betterClock(have, sample) === sample)) { clockTakenAt = Date.now(); emit({ clock: sample }); }
    applySession(r.body.session);
    emit({ devices: r.body.devices });
  } catch { /* the stream will bring the snapshot anyway */ }
}
let clockTakenAt = 0;

/* ── The write doors ────────────────────────────────────────────────────────────── */

export interface CommandReply { status: number; code: string | null; target: string | null }

/** Ask the output to do something. The idempotency key is made once and REUSED for
 *  the one retry a network failure gets — which is what makes the retry safe: the
 *  server relays a key once. */
export async function sendSessionCommand(op: string, args: Record<string, unknown> = {}): Promise<CommandReply> {
  const body = { op, args, from: current().me.id, idempotency_key: crypto.randomUUID() };
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await call<{ code?: string; target?: string }>('POST', '/api/session/commands', body);
      return { status: r.status, code: r.body?.code ?? null, target: r.body?.target ?? null };
    } catch {
      if (attempt >= 1) return { status: 0, code: 'NETWORK', target: null };
    }
  }
}

export interface StateReport {
  queue: Queue;
  context: string | null;
  item_ref: string | null;
  position_ms: number;
  playing: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  sleep_mode: string | null;
  sleep_remaining_ms: number | null;
  error?: string | null;
}

/** The output says what it is doing. `keepalive` for the one sent from pagehide —
 *  the page is going, and only a keepalive request outlives it. */
export async function reportSessionState(report: StateReport, { keepalive = false } = {}): Promise<{ status: number; code: string | null }> {
  try {
    const r = await call<{ session?: ListeningSession; code?: string }>('POST', '/api/session/state',
      { deviceId: current().me.id, ...report }, keepalive ? { keepalive: true } : {});
    if (r.ok) applySession(r.body?.session);
    return { status: r.status, code: r.body?.code ?? null };
  } catch {
    return { status: 0, code: 'NETWORK' };
  }
}

/** Make `to` the output (this device, from "Play here"; any other, from the picker). */
export async function transferSession(to: string, play?: boolean): Promise<boolean> {
  try {
    const r = await call<{ session?: ListeningSession }>('POST', '/api/session/transfer', play == null ? { to } : { to, play });
    if (r.ok) applySession(r.body?.session);
    return r.ok;
  } catch {
    return false;
  }
}

/** A device that is NOT the output says what its volume is (the output's reports
 *  carry its own) — so the picker shows every device's fader truthfully. */
export async function announceSessionVolume(volume: number, muted: boolean): Promise<void> {
  const me = current().me;
  try {
    await call('POST', '/api/session/devices', { deviceId: me.id, name: me.name, kind: me.kind, platform: me.platform, volume, muted });
  } catch { /* the next change, or the next boot, says it again */ }
}

export async function renameSessionDevice(id: string, name: string): Promise<boolean> {
  try { return (await call('PATCH', `/api/session/devices/${id}`, { name })).ok; } catch { return false; }
}

export async function forgetSessionDevice(id: string): Promise<boolean> {
  try { return (await call('DELETE', `/api/session/devices/${id}`)).ok; } catch { return false; }
}

/* ── The connection ─────────────────────────────────────────────────────────────── */

let running = false;
/** Bumped by every start. ⚠️ StrictMode mounts effects twice — start, stop, start —
 *  and a loop that only checked `running` would see it true again and carry on
 *  beside the new one: two streams per tab. Each loop runs only while it is the
 *  CURRENT generation. */
let generation = 0;
let streamAbort: AbortController | null = null;
let wake: (() => void) | null = null;

/** Wait `ms`, or less when poked (the network came back, the tab became visible). */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); wake = null; resolve(); }
    wake = done;
  });
}
const poke = () => { wake?.(); };
const onVisible = () => { if (document.visibilityState === 'visible') poke(); };

type Registered = 'ok' | 'unavailable' | 'retry';

async function register(): Promise<Registered> {
  const me = current().me;
  try {
    const r = await call('POST', '/api/session/devices', { deviceId: me.id, name: me.name, kind: me.kind, platform: me.platform });
    if (r.ok) return 'ok';
    // No session door at all (a backend that predates it), a guest (read-only), or
    // signed out: this tab is solo, and trying again will not change that.
    if (r.status === 404 || r.status === 403 || r.status === 401) return 'unavailable';
    return 'retry';
  } catch {
    return 'retry';   // offline at boot — keep trying
  }
}

type Ended = 'reauth' | 'unknown-device' | 'unavailable' | 'dropped';

async function stream(): Promise<{ ended: Ended; hello: boolean }> {
  const ac = new AbortController();
  streamAbort = ac;
  let hello = false;
  try {
    const r = await authFetch(`${API}/api/session/events?device=${current().me.id}`, {
      headers: { Accept: 'text/event-stream' }, signal: ac.signal, cache: 'no-store',
    });
    // 404: this device was forgotten (from another device's picker) — register again.
    if (r.status === 404) return { ended: 'unknown-device', hello };
    if (r.status === 401 || r.status === 403) return { ended: 'unavailable', hello };
    if (!r.ok || !r.body) return { ended: 'dropped', hello };
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { ended: 'dropped', hello };
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseSse(buf);
      buf = rest;
      for (const e of events) {
        let data: any;
        try { data = JSON.parse(e.data); } catch { continue; }
        switch (e.event) {
          case 'hello':
            hello = true;
            // A reconnect's snapshot is the truth, whatever rev this tab last held.
            emit({ status: 'live', session: data.session ?? null, devices: data.devices ?? [] });
            void sampleSnapshot();
            break;
          case 'session': applySession(data.session); break;
          case 'devices': emit({ devices: data.devices ?? [] }); break;
          case 'command': for (const l of commandListeners) l(data as SessionCommand); break;
          case 'reauth': ac.abort(); return { ended: 'reauth', hello };
          default: break;
        }
      }
    }
  } catch {
    return { ended: 'dropped', hello };
  } finally {
    if (streamAbort === ac) streamAbort = null;
  }
}

async function run(gen: number) {
  const alive = () => running && gen === generation;
  let attempt = 0;
  let registered = false;
  while (alive()) {
    if (!registered) {
      const r = await register();
      if (!alive()) return;
      if (r === 'unavailable') { emit({ status: 'unavailable' }); return; }
      if (r === 'retry') { await pause(backoffMs(attempt++)); continue; }
      registered = true;
    }
    const { ended, hello } = await stream();
    if (!alive()) return;
    if (hello) attempt = 0;
    if (ended === 'unavailable') { emit({ status: 'unavailable' }); return; }
    if (ended === 'unknown-device') { registered = false; continue; }
    // A token expiry is not a failure: the next open goes through authFetch, which
    // refreshes the cookie first. Reconnect at once.
    if (ended === 'reauth') continue;
    emit({ status: 'reconnecting' });
    await pause(backoffMs(attempt++));
  }
}

/** Connect (once per tab — later calls share it). Returns the disconnect function. */
export function startSession(): () => void {
  if (!running) {
    running = true;
    window.addEventListener('online', poke);
    document.addEventListener('visibilitychange', onVisible);
    void run(++generation);
  }
  return stopSession;
}

function stopSession() {
  running = false;
  window.removeEventListener('online', poke);
  document.removeEventListener('visibilitychange', onVisible);
  streamAbort?.abort();
  poke();
}
