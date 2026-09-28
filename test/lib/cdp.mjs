// The DevTools Protocol, spoken by hand — how the gate drives a real browser.
//
// A page that renders from fetched data cannot be captured with Chrome's
// `--screenshot` flag (it fires on `load`, before React has anything) or settled with
// `--virtual-time-budget` (virtual time races through timers whose real network
// requests never resolve inside it) — TRAPS.md. So: launch headless Chromium with a
// debugging port, open the page, WAIT FOR A REAL SIGNAL the page raises itself, then
// evaluate and capture.
//
// Node 20 has no global WebSocket and this repo takes no `ws` dependency, so the
// socket is ~60 lines of RFC 6455 over `net`: a client-masked text frame out, server
// frames (text, continuation, ping, close) in. No extensions, no compression.
//
//   import { findChromium, launch } from './lib/cdp.mjs';
//   const browser = await launch(findChromium());          // null → skip, like token-identity
//   const page = await browser.page();
//   await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
//   await page.goto(url);
//   await page.waitFor('window.__ready === true');
//   const png = await page.screenshot();                    // Buffer
//   await browser.close();

import { spawn, execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Playwright's cached Chromium first (what this machine has), then the PATH. */
export function findChromium() {
  const cache = join(process.env.HOME || '', '.cache/ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = join(cache, dir, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { /* next */ }
  }
  return null;
}

/* ── RFC 6455, client side ─────────────────────────────────────────────────── */

function wsConnect(url) {
  const { hostname, port, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    const sock = connect(Number(port), hostname);
    const key = randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    let open = false;
    const handlers = { message: () => {}, close: () => {} };
    let pieces = [];

    sock.on('connect', () => {
      sock.write(`GET ${pathname} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
        + `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    sock.on('error', (e) => (open ? handlers.close(e) : reject(e)));
    sock.on('close', () => handlers.close());
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!open) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.subarray(0, end).toString();
        if (!/^HTTP\/1\.1 101/.test(head)) { reject(new Error(`websocket upgrade refused: ${head.split('\r\n')[0]}`)); sock.destroy(); return; }
        buf = buf.subarray(end + 4);
        open = true;
        resolve({ send, close: () => sock.destroy(), on: (ev, fn) => { handlers[ev] = fn; } });
      }
      // Parse every complete frame in the buffer.
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;               // a server frame is never masked
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (op === 0x8) { sock.destroy(); return; }          // close
        if (op === 0x9) { frame(0xa, payload); continue; }   // ping → pong
        if (op === 0x1 || op === 0x0) {                      // text / continuation
          pieces.push(payload);
          if (fin) { const text = Buffer.concat(pieces).toString('utf8'); pieces = []; handlers.message(text); }
        }
      }
    });

    function frame(op, data) {
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      const mask = randomBytes(4);
      let head;
      if (payload.length < 126) head = Buffer.from([0x80 | op, 0x80 | payload.length]);
      else if (payload.length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2); }
      else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
      const body = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) body[i] = payload[i] ^ mask[i & 3];
      sock.write(Buffer.concat([head, mask, body]));
    }
    function send(text) { frame(0x1, text); }
  });
}

/* ── A CDP session over one socket ─────────────────────────────────────────── */

async function session(wsUrl) {
  const ws = await wsConnect(wsUrl);
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.on('message', (text) => {
    const msg = JSON.parse(text);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });
  ws.on('close', () => { for (const { reject } of pending.values()) reject(new Error('devtools socket closed')); pending.clear(); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };
  return { send, on, close: ws.close };
}

/**
 * Launch headless Chromium. `null` chromium → null (callers skip, as token-identity does).
 * `--no-sandbox` is for this throwaway, local-only test browser — the desktop app's
 * never-`--no-sandbox` rule is about the Electron build Jag runs.
 */
export async function launch(chromium, { timeoutMs = 30_000 } = {}) {
  if (!chromium) return null;
  const profile = mkdtempSync(join(tmpdir(), 'jkos-cdp-'));
  const child = spawn(chromium, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error(`chromium never opened its debugging port:\n${err}`)), timeoutMs);
    child.stderr.on('data', (d) => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`chromium exited (${code}) before it was ready:\n${err}`)); });
  });
  const browser = await session(wsUrl);

  return {
    /** A fresh page (tab), attached and ready for commands. */
    async page() {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const port = new URL(wsUrl).port;
      const s = await session(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      await s.send('Page.enable');
      await s.send('Runtime.enable');
      const consoleErrors = [];
      s.on('Runtime.exceptionThrown', (p) => consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception'));
      return {
        send: s.send,
        consoleErrors,
        async goto(url) {
          const loaded = new Promise((r) => s.on('Page.loadEventFired', r));
          await s.send('Page.navigate', { url });
          await loaded;
        },
        /** Evaluate an expression in the page and return its (JSON) value. */
        async eval(expression) {
          const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
          return r.result.value;
        },
        /** Poll until `expression` is truthy — a real signal the page raises, never a fixed sleep. */
        async waitFor(expression, { timeoutMs: limit = 20_000, everyMs = 100 } = {}) {
          const until = Date.now() + limit;
          for (;;) {
            if (await this.eval(`!!(${expression})`)) return;
            if (Date.now() > until) throw new Error(`timed out waiting for: ${expression}`);
            await new Promise((r) => setTimeout(r, everyMs));
          }
        },
        /** PNG of the page, or of `clip` ({x, y, width, height}) in CSS px. */
        async screenshot(clip) {
          const r = await s.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
          return Buffer.from(r.data, 'base64');
        },
        close: async () => { try { await browser.send('Target.closeTarget', { targetId }); } catch { /* gone */ } s.close(); },
      };
    },
    async close() {
      try { await browser.send('Browser.close'); } catch { /* already gone */ }
      browser.close();
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}
