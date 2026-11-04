# jkOS — Controls matrix

jkOS's security controls. Each row lists the code that enforces the control, the test that
proves it, and the audit event it records.

`pnpm check:docs` checks this file. Every cited file must exist, every cited test must run in the
test suite (except those marked off-gate), and every cited event must be one jkAuth writes.

Prefixes: **AC** access · **SM** sessions · **AU** audit log · **CM** change management ·
**CF** configuration.

## Controls

| ID | Control | Risk it addresses | Enforced in | Proved by | Evidence left |
|----|---------|-------------------|-------------|-----------|---------------|
| AC-1 | Passwords are hashed with bcrypt over a SHA-256 pre-hash, so input of any length is fully hashed. | Bcrypt silently truncates at 72 bytes, so two long passwords sharing a prefix would verify as one. | `apps/jkauth/src/password.js` | `apps/jkauth/test/smoke.mjs` | `password_change` `password_reset` |
| AC-2 | Repeated failed sign-ins lock the account for a window. This includes the shared guest account. | Online password guessing. | `apps/jkauth/src/routes/auth.js` | `apps/jkauth/test/smoke.mjs` `apps/jkauth/test/security.mjs` | `login_fail` `login_locked` `guest_login_fail` |
| AC-3 | A second factor (TOTP or emailed code) is available per user. The TOTP secret is sealed with AES-256-GCM, and enrolment is refused when no sealing key is configured. Recovery codes carry 80 bits. | A stolen password alone signs in. A database copy leaks every TOTP seed. Short recovery codes are cracked offline. | `apps/jkauth/src/twofactor.js` `apps/jkauth/src/secretbox.js` | `apps/jkauth/test/security.mjs` | `login_2fa_fail` |
| AC-4 | Tokens are RS256-signed by jkAuth alone. Every other service verifies them against the published public key, in Node and in Python. | A forged or tampered token, or a second signer drifting from the first. | `apps/jkauth/src/tokens.js` `packages/auth-middleware/index.js` `jkos-deploy/jkos_auth.py` | `apps/jkauth/test/contracts.mjs` `packages/auth-middleware/test/jwks.mjs` | — |
| AC-5 | A token is accepted only by the apps its audience names. Every Node backend refuses to start in production without an audience to check. | One cookie reaches every `*.jkos.net` host, so without this a token minted for one app is spendable at all of them. | `packages/weave/src/server/auth.js` `apps/jkauth/src/tokens.js` | `apps/jkauth/test/security.mjs` `packages/weave/test/weave.mjs` | — |
| AC-6 | Production and staging use different token issuers and cookie names, so a session in one grants nothing in the other. | A staging credential, which is easier to obtain, opens production. | `packages/auth-middleware/index.js` `apps/jkauth/docker-compose.staging.yml` | `apps/jkauth/test/contracts.mjs` | — |
| AC-7 | Least privilege comes from one table: a route names an action and the policy module decides. No route compares roles itself. | An authorization check forgotten on one of many routes. | `apps/jkauth/src/policy.js` | `test/policy.mjs` `apps/jkauth/test/multiuser.mjs` | `widget_publish_rejected` |
| AC-8 | Write access needs a write scope, and the scopes jkAuth grants are generated from what each app declares rather than typed by hand. | A read-only token writes, or a granted scope names nothing real. | `packages/weave/src/server/writeGate.js` `packages/suite-manifest/scripts/gen-scopes.mjs` | `apps/jkauth/test/lifecycle.mjs` | — |
| AC-9 | Service accounts, and service accounts acting for a user, must be on an explicit allow-list. | A machine credential acting as any user. | `apps/jkauth/src/routes/auth.js` | `apps/jkauth/test/lifecycle.mjs` `apps/jkauth/test/multiuser.mjs` | `service_token` `service_token_denied` `service_token_delegation_denied` |
| AC-10 | A hostname the edge doesn't host is refused: no TLS handshake on 443, connection closed on 80. The default server is declared, not left to config order. | Any domain pointed at the server is served an app; until this, unknown names fell through to KourOS. | `infra/nginx/standalone.conf` | `infra/nginx/gen-nginx-weave.mjs` | — |
| SM-1 | Refresh tokens rotate on every use. Replaying a rotated one revokes every token from that sign-in. | A stolen refresh token keeps working alongside the real user. | `apps/jkauth/src/tokens.js` | `apps/jkauth/test/security.mjs` | `refresh_reuse` |
| SM-2 | A session has an absolute lifetime that even continuous refreshing cannot extend. | A session that never ends. | `apps/jkauth/src/tokens.js` `apps/jkauth/src/config.js` | `apps/jkauth/test/security.mjs` | `session_absolute_timeout` |
| SM-3 | A revoked session is kept as a record with a reason (logout, reuse, timeout), never deleted. | Revocation destroying the evidence an incident review needs. | `apps/jkauth/src/db.js` | `apps/jkauth/test/security.mjs` | `logout` `session_revoked` |
| SM-4 | The database itself refuses two things: a native sign-in code being redeemed twice, and a session changing which client it belongs to. | An application bug that bypasses a route-level check. | `apps/jkauth/src/db.js` | `apps/jkauth/test/native.mjs` | `native_code_reuse` `refresh_wrong_transport` |
| AU-1 | Every authentication decision is written to `auth_events`. The client IP comes only from the one trusted proxy hop, and the service refuses to boot if that setting changes. | A missing record, or one carrying an IP the attacker chose. | `apps/jkauth/src/db.js` `apps/jkauth/src/app.js` | `apps/jkauth/test/security.mjs` `apps/jkauth/test/multiuser.mjs` | `login` `login_fail` `password_change` |
| AU-2 | Each user reads their own audit trail. Only an admin reads the whole suite's. | Users reading each other's activity. | `apps/jkauth/src/routes/weave.js` `apps/jkauth/src/policy.js` | `apps/jkauth/test/multiuser.mjs` `test/policy.mjs` | — |
| CM-1 | Every staging URL is admin-only. nginx asks staging jkAuth before serving each request, and the nginx config is generated, not hand-edited. | Unreleased code, or the deploy console, reachable by anyone. | `infra/nginx/gen-nginx-weave.mjs` `infra/nginx/standalone.conf` `apps/jkauth/src/routes/profile.js` | `infra/nginx/gen-nginx-weave.mjs` `apps/jkauth/test/smoke.mjs` | — |
| CM-2 | Deploy and promote actions require an admin session. Break-glass access is off unless configured, and is logged loudly when used. | An unauthorized production change. | `jkos-deploy/main.py` `jkos-deploy/jkos_auth.py` | `apps/jkauth/test/contracts.mjs` `jkos-deploy/scripts/selftest.sh` | deploy log |
| CM-3 | Promotion ships exactly the commit staging ran. There is no merge step, and the server holds no push credential. A deploy fails if any container is not running or reports itself unhealthy, and nginx config is validated before restart. | Untested code reaching production, or a half-started deploy reported as done. | `infra/scripts/lib-deploy.sh` `infra/scripts/deploy-prod.sh` `jkos-deploy/main.py` | `jkos-deploy/scripts/selftest.sh` | deploy log |
| CF-1 | No secret material is tracked in git, and `.gitignore` keeps excluding env files and keys. | A credential published with the source. | `test/secrets.mjs` | `test/secrets.mjs` | — |
| CF-2 | Any HIGH or CRITICAL dependency advisory fails the gate. | Shipping a known-vulnerable dependency. | `test/supply-chain.mjs` | `test/supply-chain.mjs` | — |
| CF-3 | The installable Android and desktop apps keep their lockdown settings: no app backup, no Node in the page, a sandbox, and only the suite's own origins. | One configuration token silently reopening the shell. | `native/gen-native.mjs` | `test/native.mjs` | — |

## Known gaps

- **No CI.** The test suite runs only when the author runs it. Nothing blocks pushing a failing
  commit.
- **No off-site backup yet.** The backup script has run once by hand. The scheduled job isn't
  installed ([TODO.md](TODO.md) §1).
- **Calendar tokens can be stored in plaintext.** BeigeBoard encrypts calendar OAuth tokens with
  AES-256-GCM only when `CALENDAR_ENC_KEY` is set. Unlike AC-3, it still starts without the key.
- **jkDeploy doesn't check the token audience.** It is only reachable through the CM-1 admin gate.
- **The deploy test isn't in the suite.** `jkos-deploy/scripts/selftest.sh` needs Docker, so it is
  run by hand. CM-2 and CM-3 are tested less often than the rest.

## Run the tests

```bash
pnpm install
pnpm test:contracts                  # full suite: every test above except the off-gate one
node apps/jkauth/test/security.mjs   # SM-1 to SM-3, AC-3, AC-5 against a running server
```
