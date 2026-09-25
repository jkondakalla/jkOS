// The boot-real-server smoke harness — TESTING.md's harness contract, held in one place.
//
// Thirteen backend smokes carried the same boot, health-wait and teardown code until
// 2026-09-25, byte for byte apart from the file name, and one had drifted in the way that
// matters: routine-spec.smoke's catch logged "harness error" and exited 0, so a crash before
// the first assertion reported green. Here each property of the contract is true by
// construction rather than by copying:
//
//   - /health must name THIS service; a stranger on the port is reported, not trusted (OPS-1).
//   - A child that exits before it is healthy stops the wait at once.
//   - The server's own log prints on ANY failure.
//   - A server that never boots, a crash, or a run with no assertions at all exits non-zero.
//   - The temp dir is removed on exit, pass or fail.
//
//   const { tmp, ok, boot, done, crashed } = smoke('contract.smoke');
//   try {
//     await boot({ cwd: BACKEND, port: PORT, service: 'beigeboard', env: { DB_PATH } });
//     ok(cond, 'what must hold');
//   } catch (e) { crashed(e); } finally { done(); }
//
// A suite with its own tally (jkAuth's) uses startServer() directly for the boot half.
//
// Ports stay a `const PORT = <n>` literal in the smoke itself: the port-registry probe holds
// that literal to its TEST_PORTS claim.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

/** The Fetch spec's "bad ports" (fetch.spec.whatwg.org, "port blocking"). Node's fetch() refuses
 *  them with "bad port" before touching the network, so a test server bound to one can never be
 *  reached and waits out its whole budget. jkAuth's smoke drew 4900–5299 plus a sequence and
 *  landed on SIP's 5060/5061 about one run in thirty, reported as "never became healthy". */
export const FETCH_BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

/** A random port in [lo, lo + span) that fetch() can reach. For the suites that pick a port per
 *  run rather than claiming one in TEST_PORTS. */
export function testPort(lo, span) {
  for (;;) {
    const port = lo + Math.floor(Math.random() * span);
    if (!FETCH_BAD_PORTS.has(port)) return port;
  }
}

/** Spawn a real server (`node <args>` in `cwd`, NODE_ENV cleared, PORT set; `env` overrides
 *  both) and capture its output. `await ready()` waits up to `timeoutMs` for /health to answer
 *  200 naming `service`, and resolves { ok: true } or { ok: false, why } — it stops the moment
 *  the child exits, and names a stranger on the port rather than trusting it. The budget is
 *  15 s because nine servers boot in one gate run (TESTING.md, the harness contract). */
export function startServer({ cwd, port, service, env = {}, args = ['server.js'], timeoutMs = 15000 }) {
  if (FETCH_BAD_PORTS.has(port)) {
    throw new Error(`port ${port} is on the Fetch spec's bad-port list: fetch() refuses it, so the server ` +
                    `could never be reached. Pick another (testPort() skips them).`);
  }
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, NODE_ENV: '', PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '', exited = null;
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  const base = `http://127.0.0.1:${port}`;

  async function ready() {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (exited) return { ok: false, why: `the server exited (code=${exited.code} signal=${exited.signal})` };
      try {
        const res = await fetch(`${base}/health`);
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.service === service) return { ok: true };
          return { ok: false, why: `/health answered 200 but service=${JSON.stringify(body.service)}, ` +
                                   `expected '${service}': another server owns port ${port}` };
        }
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    return { ok: false, why: `no answer within ${timeoutMs / 1000} s` };
  }

  return {
    base, child, ready,
    log: () => log,
    exited: () => exited,
    stop() { try { child.kill('SIGKILL'); } catch { /* already gone */ } },
  };
}

export function smoke(name) {
  const tmp = mkdtempSync(join(tmpdir(), `jkos-${name.replace(/[^\w]+/g, '-')}-`));
  process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
  let server = null;

  /** startServer() + ready(). Never returns if the server doesn't come up: it counts the
   *  failure, prints why and the server log, and exits via done(). */
  async function boot(opts) {
    server = startServer(opts);
    const up = await server.ready();
    if (up.ok) return server;
    fail++;
    console.error(`  ✗ ${name}: the server never became healthy — ${up.why}`);
    done();
  }

  /** Count an exception that escaped the assertions as a failure. */
  function crashed(e) {
    fail++;
    console.error(`  ✗ ${name} crashed:`, e);
  }

  /** Stop the server and exit: 1 on any failure, and on a run that asserted nothing. */
  function done() {
    server?.stop();
    if (!pass && !fail) {
      fail++;
      console.error(`  ✗ ${name} ran no assertions — a smoke that checks nothing is not green`);
    }
    if (fail && server?.log()) console.error('\n── server log ──\n' + server.log());
    console.log(`\n${name}: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }

  return {
    tmp, ok, boot, crashed, done,
    log: () => server?.log() ?? '',
    exited: () => server?.exited() ?? null,
  };
}

/** A throwaway RS256 keypair and a signer for suite-shaped access tokens. Tell the server to
 *  trust `publicKey` (JKOS_AUTH_PUBLIC_KEY) and it verifies these like jkAuth's own; the
 *  dev-stub auth can only ever inject ONE identity, so cross-user scoping needs this. */
export function forgeTokens({ issuer = 'jkos-auth' } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  function mkToken(claims, ttlSec = 900) {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: '1' }));
    const now = Math.floor(Date.now() / 1000);
    const payload = b64url(JSON.stringify({ iss: issuer, iat: now, exp: now + ttlSec, ...claims }));
    const input = `${header}.${payload}`;
    return `${input}.${b64url(cryptoSign('RSA-SHA256', Buffer.from(input), privateKey))}`;
  }
  return { publicKey, privateKey, mkToken };
}
