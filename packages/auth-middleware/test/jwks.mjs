// @jkos/auth-middleware — JWKS key-rotation + static-key regression test.
//
//   node packages/auth-middleware/test/jwks.mjs
//
// Stands up a tiny in-process JWKS endpoint, then drives the middleware through:
// verify-by-kid, unknown-kid refetch (rotation), expiry, and the static-key path.
// No network, no secrets. Exit 0 = all green.

import http from 'node:http';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { jkosAuth } = require('../index.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}  ${extra}`); } };

const ISSUER = 'jkos-auth-test';
const mkKey = () => generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const jwkFor = (pem, kid) => ({ ...createPublicKey(pem).export({ format: 'jwk' }), use: 'sig', alg: 'RS256', kid });
const sign = (priv, kid, payload = {}, opts = {}) =>
  jwt.sign({ sub: 1, role: 'admin', ...payload }, priv, { algorithm: 'RS256', issuer: ISSUER, keyid: kid, expiresIn: '5m', ...opts });

// Run a middleware once against a faked req/res; resolve with {status, body, nextCalled}.
function drive(mw, token) {
  return new Promise(resolve => {
    const req = { cookies: token === undefined ? {} : { jkos_token: token } };
    let status = 200;
    const res = {
      status(c) { status = c; return this; },
      json(body) { resolve({ status, body, nextCalled: false, user: req.user }); return this; },
    };
    const ret = mw(req, res, () => resolve({ status: 200, body: null, nextCalled: true, user: req.user }));
    if (ret && typeof ret.catch === 'function') ret.catch(e => resolve({ status: 500, body: { error: e.message }, nextCalled: false }));
  });
}

async function main() {
  const A = mkKey();   // active key
  const B = mkKey();   // rotation target

  // Mutable JWKS set, served by a local http server.
  let served = [jwkFor(A.publicKey, 'a')];
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: served }));
  });
  await new Promise(r => server.listen(0, r));
  const jwksUri = `http://127.0.0.1:${server.address().port}/jwks`;

  console.log('JWKS middleware');
  // minRefetchMs:0 so an unknown kid triggers an immediate refetch within the test.
  const mw = jkosAuth({ jwksUri, issuer: ISSUER, jwksOptions: { minRefetchMs: 0 } });

  let r = await drive(mw, sign(A.privateKey, 'a'));
  ok('valid token (kid a) → next(), req.user set', r.nextCalled && r.user?.sub === 1, JSON.stringify(r));

  r = await drive(mw);
  ok('no cookie → 401 UNAUTHENTICATED', r.status === 401 && r.body?.code === 'UNAUTHENTICATED');

  r = await drive(mw, sign(A.privateKey, 'zzz'));
  ok('unknown kid → 401', r.status === 401 && r.body?.code === 'UNAUTHENTICATED', JSON.stringify(r));

  r = await drive(mw, sign(B.privateKey, 'b'));
  ok('token signed by un-published key b → 401 (not yet in JWKS)', r.status === 401, JSON.stringify(r));

  // Rotate: publish key b. The middleware should refetch on the now-known-but-
  // uncached kid and verify successfully.
  served = [jwkFor(A.publicKey, 'a'), jwkFor(B.publicKey, 'b')];
  r = await drive(mw, sign(B.privateKey, 'b'));
  ok('after rotation, kid b verifies (refetch on unknown kid)', r.nextCalled && r.user?.sub === 1, JSON.stringify(r));

  r = await drive(mw, sign(A.privateKey, 'a'));
  ok('old kid a still verifies during overlap', r.nextCalled, JSON.stringify(r));

  r = await drive(mw, sign(A.privateKey, 'a', {}, { expiresIn: -10 }));
  ok('expired token → 401 TOKEN_EXPIRED', r.status === 401 && r.body?.code === 'TOKEN_EXPIRED', JSON.stringify(r));

  r = await drive(mw, 'not-a-jwt');
  ok('garbage token → 401', r.status === 401, JSON.stringify(r));

  console.log('Static-key path (unchanged)');
  const mwStatic = jkosAuth({ publicKey: A.publicKey, issuer: ISSUER });
  r = await drive(mwStatic, sign(A.privateKey, 'a'));
  ok('static key verifies regardless of kid', r.nextCalled && r.user?.sub === 1, JSON.stringify(r));
  r = await drive(mwStatic, sign(B.privateKey, 'b'));
  ok('static key rejects a different signer', r.status === 401, JSON.stringify(r));

  server.close();
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('jwks harness error:', e); process.exit(1); });
