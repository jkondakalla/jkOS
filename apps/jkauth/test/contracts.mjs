// test:contracts — the suite's cross-runtime token conformance gate.
//
// The /deploy loop happened because a jkAuth-minted token verified in node but
// NOT in python-jose: two runtimes, one contract, no test that they agreed. This
// is that test. It mints a token shaped exactly like jkAuth's access token and
// verifies it through BOTH verifiers that exist in the suite:
//
//   * node   — @jkos/weave/server's verifyToken (re-exported @jkos/auth-middleware)
//   * python — jkos-deploy/jkos_auth.py's verify_token (python-jose)
//
// and asserts the claims every consumer relies on (string sub, issuer, kid, aud,
// scope, role). Revert the Phase-1 `String(user.id)` fix and this goes red.
//
// The python half is the WHOLE POINT — it's the runtime that broke. It runs via
// $CONTRACTS_PYTHON (default `python3`); point it at a venv with python-jose. The
// gate FAILS (not skips) if that runtime can't import jose, unless
// CONTRACTS_SKIP_PYTHON=1 is set (loudly discouraged).

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyToken, CODES } from '@jkos/weave/server'
import { resolveIssuer, cookieName, ISSUER_DEFAULT, ACCESS_COOKIE_BASE } from '@jkos/auth-middleware'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')          // apps/jkauth/test → repo root
const deployDir = join(repoRoot, 'jkos-deploy')

let pass = 0
const ok = (label, cond, detail = '') => {
  assert.ok(cond, `${label} ${detail}`)
  pass++
  console.log(`  ✓ ${label}`)
}

// ── Mint a token shaped like jkAuth's signAccess (the contract under test) ───────
const ISSUER = 'jkos-auth-staging'
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const sign = (claims, opts = {}) =>
  jwt.sign(claims, privateKey, { algorithm: 'RS256', issuer: ISSUER, keyid: '1', expiresIn: '15m', ...opts })

// String sub — exactly what Phase 1 made jkAuth emit. role/scope/aud as roleClaims
// would produce them.
const token = sign(
  { sub: String(7), email: 'a@jkos.net', name: 'Ada', role: 'admin', scope: ['ordeck:read', 'beigeboard:write'] },
  { audience: ['ordeck', 'beigeboard'] })

// The PRE-fix shape: a numeric sub. Kept to prove the trap is real (section 3).
const numericToken = sign(
  { sub: 7, email: 'a@jkos.net', name: 'Ada', role: 'admin', scope: ['ordeck:read'] },
  { audience: ['ordeck'] })

console.log('1 · the minted token honours the contract')
const hdr = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())
const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
ok('header has kid (JWKS-resolvable)', hdr.kid === '1' && hdr.alg === 'RS256', JSON.stringify(hdr))
ok('sub is a string (RFC 7519, the trap)', typeof body.sub === 'string', JSON.stringify(body.sub))
ok('carries aud + scope arrays', Array.isArray(body.aud) && Array.isArray(body.scope))

// ── node verifier (@jkos/auth-middleware via @jkos/weave/server) ─────────────────
console.log('2 · node verifier accepts it')
const np = verifyToken(token, { publicKey, issuer: ISSUER })
ok('node verifyToken accepts; sub is string', typeof np.sub === 'string' && np.sub === '7', JSON.stringify(np.sub))
ok('node sees role + scope', np.role === 'admin' && np.scope.includes('ordeck:read'))
assert.throws(() => verifyToken(token + 'x', { publicKey, issuer: ISSUER }))
ok('node rejects a tampered token', true)
assert.throws(() => verifyToken(token, { publicKey, issuer: 'jkos-auth' }))   // prod issuer
ok('node rejects a wrong-issuer token', true)

// ── error-code vocabulary (the codes the FE branches on must exist + be stable) ──
console.log('2b · node CODES vocabulary is the single source')
ok('CODES has the refresh-trigger codes authFetch keys on',
  CODES.TOKEN_EXPIRED === 'TOKEN_EXPIRED' && CODES.UNAUTHENTICATED === 'UNAUTHENTICATED')
ok('CODES carries the authz + write-gate vocabulary',
  CODES.FORBIDDEN === 'FORBIDDEN' && CODES.INSUFFICIENT_SCOPE === 'INSUFFICIENT_SCOPE' &&
  CODES.NO_AUTH === 'NO_AUTH' && CODES.READ_ONLY === 'READ_ONLY' && CODES.NO_USER_CONTEXT === 'NO_USER_CONTEXT')

// ── identity defaults (issuer + cookie base) — the two literals every system shares ──
console.log('2c · issuer/cookie single-source resolvers')
ok('ISSUER_DEFAULT is the shared prod issuer + resolveIssuer honours it',
  ISSUER_DEFAULT === 'jkos-auth' && resolveIssuer() === ISSUER_DEFAULT, ISSUER_DEFAULT)
ok('cookieName applies the env suffix to the shared access-cookie base',
  ACCESS_COOKIE_BASE === 'jkos_token' && cookieName(ACCESS_COOKIE_BASE) === ACCESS_COOKIE_BASE)

// ── python verifier (jkos-deploy/jkos_auth.py via python-jose) ───────────────────
console.log('3 · python verifier (jkos-deploy/jkos_auth.py) accepts it')
const PY = process.env.CONTRACTS_PYTHON || 'python3'
const probe = spawnSync(PY, ['-c', 'import jose'], { encoding: 'utf8' })
if (probe.status !== 0) {
  if (process.env.CONTRACTS_SKIP_PYTHON === '1') {
    console.log(`  ⚠ SKIPPED — '${PY}' can't import python-jose (CONTRACTS_SKIP_PYTHON=1).`)
    console.log(`            This is the half that broke /deploy — do NOT skip in CI.`)
  } else {
    console.error(`\n✗ CONTRACTS GATE INCOMPLETE: '${PY}' cannot import python-jose.\n` +
      `  The Python verifier is the runtime that 401'd every token and looped /deploy —\n` +
      `  the gate is meaningless without it. Install python-jose or set CONTRACTS_PYTHON\n` +
      `  to a venv that has it (CONTRACTS_SKIP_PYTHON=1 to bypass, not recommended).`)
    process.exit(1)
  }
} else {
  const dir = mkdtempSync(join(tmpdir(), 'jkos-contracts-'))
  const tokFile = join(dir, 'token.txt'); writeFileSync(tokFile, token)
  const numFile = join(dir, 'numeric.txt'); writeFileSync(numFile, numericToken)
  const keyFile = join(dir, 'pub.pem'); writeFileSync(keyFile, publicKey)
  const py = `
import os, sys, json
os.environ['JKOS_AUTH_PUBLIC_KEY'] = open(sys.argv[3]).read()
os.environ['JKOS_AUTH_ISSUER'] = '${ISSUER}'
os.environ['JKOS_COOKIE_SUFFIX'] = '_staging'
os.environ['BREAK_GLASS_TOKEN'] = 'glass-secret'   # ARCH-8 fallback, tested below
# no JKOS_AUTH_JWKS_URI → jkauth_reachable() is False → jkAuth "unreachable"
sys.path.insert(0, sys.argv[1])
import jkos_auth
from jose import jwt as jose_jwt, JWTError

# (a) the suite's verifier accepts the string-sub contract token
p = jkos_auth.verify_token(open(sys.argv[2]).read())
assert isinstance(p['sub'], str), 'python got non-string sub: %r' % (p['sub'],)
assert p['role'] == 'admin', p

# (b) our verifier now REJECTS a numeric sub too — the verify_sub:False workaround is
#     retired (ARCH-7.3), so jkos_auth is as strict as node/default python-jose. A
#     numeric-sub regression now fails CLOSED here instead of being silently tolerated.
rejected = False
try:
    jkos_auth.verify_token(open(sys.argv[4]).read())
except JWTError:
    rejected = True
assert rejected, 'jkos_auth.verify_token must REJECT a numeric sub after ARCH-7.3 (verify_sub retired)'

# (c) THE TRAP: python-jose's DEFAULT (strict) options REJECT a numeric sub — this
#     is the exact 401 that looped /deploy, and now matches what (b) does. Proves why
#     the string-sub contract matters and that jkos_auth no longer papers over it.
trapped = False
try:
    jose_jwt.decode(open(sys.argv[4]).read(), os.environ['JKOS_AUTH_PUBLIC_KEY'],
                    algorithms=['RS256'], issuer='${ISSUER}', options={'verify_aud': False})
except JWTError:
    trapped = True
assert trapped, 'strict python-jose did NOT reject a numeric sub — trap assumptions changed'

# (b3) Break-glass fallback (ARCH-8): a static admin bearer accepted ONLY when it is
#      configured, matches, AND jkAuth is unreachable — so a leaked token is inert while
#      SSO works. All three gates asserted here (jose-only, no network).
def _raises(fn):
    try:
        fn(); return False
    except JWTError:
        return True
bg = jkos_auth.verify_break_glass('glass-secret')          # configured + match + unreachable
assert bg['role'] == 'admin' and bg.get('break_glass') is True, bg
assert _raises(lambda: jkos_auth.verify_break_glass('wrong')), 'break-glass accepted a wrong token'
assert _raises(lambda: jkos_auth.verify_break_glass('')), 'break-glass accepted an empty token'
jkos_auth.jkauth_reachable = lambda: True                  # jkAuth back up → must refuse
assert _raises(lambda: jkos_auth.verify_break_glass('glass-secret')), 'break-glass accepted while jkAuth reachable'
jkos_auth.jkauth_reachable = lambda: False
jkos_auth.BREAK_GLASS_TOKEN = ''                           # feature off → must refuse
assert _raises(lambda: jkos_auth.verify_break_glass('glass-secret')), 'break-glass accepted while unconfigured'
jkos_auth.BREAK_GLASS_TOKEN = 'glass-secret'

# (d) emit the python CODES mirror + identity defaults so node can assert parity
print('BGOK')
print('CODESJSON', json.dumps(jkos_auth.CODES))
print('IDENT', jkos_auth.ISSUER_DEFAULT, jkos_auth.ACCESS_COOKIE_BASE)
print('PYOK', p['sub'], p['role'], jkos_auth.COOKIE_NAME)
`
  const r = spawnSync(PY, ['-c', py, deployDir, tokFile, keyFile, numFile], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('  python verifier FAILED:\n' + (r.stderr || r.stdout))
    process.exit(1)
  }
  ok('python jkos_auth.verify_token accepts the string-sub token', /^PYOK 7 admin jkos_token_staging/m.test(r.stdout.trim()), r.stdout.trim())
  ok('python jkos_auth now REJECTS a numeric sub (verify_sub:False retired, ARCH-7.3) — as strict as default python-jose (the trap closed)', true)
  ok('node and python agree on the same token (cross-runtime contract holds)', true)
  ok('break-glass (ARCH-8) accepts only when configured+matching+jkAuth-unreachable, refuses all else', /^BGOK$/m.test(r.stdout.trim()), r.stdout.trim())

  // ── error-code parity: node CODES === python CODES, key-for-key ────────────────
  console.log('4 · error-code vocabulary agrees across runtimes (node ↔ python)')
  const cm = r.stdout.match(/^CODESJSON (.*)$/m)
  ok('python emitted its CODES mirror', !!cm, r.stdout.trim())
  const pyCodes = JSON.parse(cm[1])
  const nodeKeys = Object.keys(CODES).sort()
  const pyKeys = Object.keys(pyCodes).sort()
  ok('node and python CODES have the SAME keys', JSON.stringify(nodeKeys) === JSON.stringify(pyKeys),
    `node=${nodeKeys} py=${pyKeys}`)
  for (const k of nodeKeys) {
    ok(`code ${k} has the same value in node + python`, CODES[k] === pyCodes[k], `node=${CODES[k]} py=${pyCodes[k]}`)
  }

  // ── identity defaults + cookie-name construction agree across runtimes ─────────
  const im = r.stdout.match(/^IDENT (\S+) (\S+)$/m)
  ok('python emitted its identity defaults', !!im, r.stdout.trim())
  ok('issuer default agrees node↔python', im[1] === ISSUER_DEFAULT, `node=${ISSUER_DEFAULT} py=${im[1]}`)
  ok('access-cookie base agrees node↔python', im[2] === ACCESS_COOKIE_BASE, `node=${ACCESS_COOKIE_BASE} py=${im[2]}`)
  // Given the SAME env suffix, both runtimes must build the SAME cookie name
  // (python printed 'jkos_token_staging' in PYOK under JKOS_COOKIE_SUFFIX=_staging).
  const prev = process.env.JKOS_COOKIE_SUFFIX
  process.env.JKOS_COOKIE_SUFFIX = '_staging'
  ok('node + python build the same cookie name under _staging',
    cookieName(ACCESS_COOKIE_BASE) === 'jkos_token_staging', cookieName(ACCESS_COOKIE_BASE))
  if (prev === undefined) delete process.env.JKOS_COOKIE_SUFFIX
  else process.env.JKOS_COOKIE_SUFFIX = prev
}

console.log(`\nPASS: ${pass} passed, 0 failed`)
