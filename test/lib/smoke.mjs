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
// Ports stay a `const PORT = <n>` literal in the smoke itself: the port-registry probe holds
// that literal to its TEST_PORTS claim.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

export function smoke(name) {
  const tmp = mkdtempSync(join(tmpdir(), `jkos-${name.replace(/[^\w]+/g, '-')}-`));
  process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
  let child = null, serverLog = '', exited = null;

  /** Spawn the real server (`node <args>` in `cwd`, NODE_ENV cleared, PORT set) and wait up to
   *  `timeoutMs` for its /health to answer 200 naming `service`. Never returns if it doesn't:
   *  it counts the failure, prints why and the server log, and exits via done(). The budget
   *  is 15 s because nine servers boot in one gate run (TESTING.md, the harness contract). */
  async function boot({ cwd, port, service, env = {}, args = ['server.js'], timeoutMs = 15000 }) {
    child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, NODE_ENV: '', PORT: String(port), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { serverLog += d; });
    child.stderr.on('data', (d) => { serverLog += d; });
    child.on('exit', (code, signal) => { exited = { code, signal }; });

    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + timeoutMs;
    let why = `no answer within ${timeoutMs / 1000} s`;
    while (Date.now() < deadline) {
      if (exited) { why = `the server exited (code=${exited.code} signal=${exited.signal})`; break; }
      try {
        const res = await fetch(`${base}/health`);
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.service === service) return { base, child };
          why = `/health answered 200 but service=${JSON.stringify(body.service)}, expected ` +
                `'${service}': another server owns port ${port}`;
          break;
        }
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    fail++;
    console.error(`  ✗ ${name}: the server never became healthy — ${why}`);
    done();
  }

  /** Count an exception that escaped the assertions as a failure. */
  function crashed(e) {
    fail++;
    console.error(`  ✗ ${name} crashed:`, e);
  }

  /** Stop the server and exit: 1 on any failure, and on a run that asserted nothing. */
  function done() {
    try { child?.kill('SIGKILL'); } catch { /* already gone */ }
    if (!pass && !fail) {
      fail++;
      console.error(`  ✗ ${name} ran no assertions — a smoke that checks nothing is not green`);
    }
    if (fail && serverLog) console.error('\n── server log ──\n' + serverLog);
    console.log(`\n${name}: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }

  return { tmp, ok, boot, crashed, done, log: () => serverLog, exited: () => exited };
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
