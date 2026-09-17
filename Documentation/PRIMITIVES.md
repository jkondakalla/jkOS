# jkOS — Primitives (the command/gate catalog)

Every command and gate you can run in this suite — with what each is for and how to use it.
Organized by category. When this doc disagrees with the code, the code wins — update this.
(This doc used to also census every `@jkos/*` package export; that section was dropped —
a third of `@jkos/cards`' own exports had no consumers left in any app, so the census was
already wrong. Read the package's own `src/index.ts` for its current surface.)

Everything runs from the repo root `/media/jag/The Forge/jkOS` (the path has a space —
quote it). Branch `staging`. (`services/` is gone — the two
Python sidecars in it were deleted 2026-07-13 with the rest of the archaic LazurOS surface.)

---

## 1 · Suite commands (root `package.json`)

| Command | What it does |
|---------|-------------|
| `pnpm install` | One workspace install. **Also required after editing any `packages/*` source** — pnpm copies workspace packages into `.pnpm`, so consumers won't see your edit until you re-run this. |
| `pnpm dev` | `turbo run dev` — all apps in dev mode. (ORDECK's vite dev is broken — CJS `codes.js` import chain; verify ORDECK via `build` + `preview` instead.) |
| `pnpm build` | `turbo run build` — all apps. `pnpm --filter @jkos/<app> build` for one. |
| `pnpm typecheck` | `turbo run typecheck` — cheapest whole-suite signal; run first. |
| `pnpm test:contracts` | **The gate.** Chains every hard contract in the suite (§2). Exit 0 = green. Run after every meaningful change. |
| `pnpm prove` | The suite prober — read-only cross-system conformance report (§2.3). |
| `pnpm roundtrip` | The write round-trip — boots the real BeigeBoard backend and drives create→read→update→complete→delete through discovered docs (§2.3). |
| `pnpm new-app <id>` | Scaffold a complete Layer-A-conformant app (§3). `--remove` undoes it. |
| `pnpm check:tokens` \| `check:token-identity` \| `check:nginx` \| `check:responsive` \| `check:drag` \| `check:cards` \| `check:routine` \| `check:hud` \| `check:docker` \| `check:async-view` \| `check:overlay` \| `check:design` \| `check:fields` \| `check:scroll` \| `check:text` \| `check:today` \| `check:refs` \| `check:binding` \| `check:pulsarmap` \| `check:vibespace` \| `check:runes` \| `check:columns` \| `check:rulings` \| `check:scopes` \| `check:audit` \| `check:secrets` \| `check:policy` \| `check:auth` \| `check:docs` \| `check:build` | **30 individual conformance gates** (§2.2) — each is also inside `test:contracts`. ⚠️ This line said *fifteen* for eight gates longer than it was true; `check:docs` now holds the number to the `check:*` scripts that actually exist. |
| `pnpm test:cards` | Pure-logic unit tests for `@jkos/design` color + `@jkos/cards` datetime math (49 assertions). |

---

## 2 · Testing & verification

Full reference (what each test asserts, house patterns, how to add one): [TESTING.md](TESTING.md).

### 2.1 The gate — `pnpm test:contracts`

One command, every hard contract. Its links, in order:

*Counts measured 2026-09-08 from one green run. They are indicative — `check:docs`
holds the INVENTORY (no suite may go unlisted) and deliberately does not pin the
numbers, since a gate that reddens on every added assertion is one people skip.*

| Link | Runs | Guards |
|------|------|--------|
| `--filter @jkos/jkauth test:contracts` | `contracts.mjs` (30) | codes vocab node↔python parity, issuer/cookie single-source, numeric-sub rejection, break-glass gates |
| `--filter @jkos/jkauth test` | `smoke.mjs` (76) + `lifecycle.mjs` (24) + `multiuser.mjs` (27) + `security.mjs` (55) + `account.mjs` (39) | auth flows, cookie flags, rotation/reuse, guest/service/delegation, python cross-verify, prefs deep-merge + 409 lock, role-scoped widgets; `security.mjs` pins the six high-severity fixes from the 2026-08-26 jkAuth audit (guest password actually checked, reuse detection covers the token's whole life, idle/absolute session TTLs, sealed TOTP secrets, the session-cap tie-break, tombstoned-not-deleted revocations) |
| `--filter @jkos/weave test` | `weave.mjs` (63) + `lego.mjs` (103) + `libraryScanner.mjs` (53) + `mediaRoutes.mjs` (36) + `resumeCursor.mjs` | docShape, capability/dataset schema, AppId d.ts⇄runtime parity, collection/connector/trigger bricks |
| `--filter @jkos/player test` | `core.test` (84) + `backend.test` (40) + `engine.test` (34) | timeline math parity with papyros's retired `position.ts` (locate boundary rule, clamps), Queue reducers + seeded-shuffle stability, MediaBackend event/error classification on a scripted fake element, rate/recovery-ladder arithmetic |
| `--filter @jkos/beigeboard-backend test` | `import.smoke` (39) + `items.smoke` (71) + `routines.smoke` (78) + `routine-spec.smoke` (113) + `delta.smoke` (14) + `contract.smoke` (14) + `calendar.sandbox` (44) | import pipeline, CRUD hardening + reserved-source guard, the routine mint/reconcile rules over HTTP, the routine-spec engine↔mirror HTTP surface, `?since` cursor, declared==enforced, calendar providers + wipe guard + enc round-trip |
| `pnpm roundtrip` | `roundtrip.mjs` (23) | the discovered write path end-to-end |
| `--filter @jkos/lazuros-backend test` | queue (28) + providers (32) + writeback (14) + worker-e2e (28) + worker-py (wraps 19) | job queue, provider factories, delegated write-back, real worker.py against the real `/internal` API |
| `--filter @jkos/files test` | `files.smoke.mjs` (29) | the Range-stream + path-containment contract (200/206/416, Accept-Ranges/Content-Range) against a real `http.createServer` — the base surface every backend's `res` object is built on |
| `--filter @jkos/papyros-backend test` | `probe.smoke` (35) + `library.smoke` (50) + `playback.smoke` (58) + `meta.smoke` (40) + `history.smoke` (40) | ffprobe-tag→column mapping (pure), library scanner e2e against a committed fixture library (duration, embedded chapters, multi-file aggregation, `?title=` filter), owner-scoped playback/progress + range-aware streaming, iTunes metadata-match enrichment, append-only play-history. **Needs `ffprobe` + `ffmpeg` on PATH** (compat-pipeline asserts spawn the encoder) — SKIPs cleanly (exit 0) if absent. |
| `--filter @jkos/kouros-backend test` | `library.smoke` (50) + `playback.smoke` (43) + `history.smoke` (40) + `discover.smoke` (26) | library scan e2e against a fixture library, owner-scoped playback/progress + range-aware streaming, append-only play-history with cross-user token scoping, the embedder-seam join (music `index.db` vectors resolving onto the real catalog) |
| `pnpm test:cards` | `test/cards-logic.mjs` (49) | withAlpha + datetime/lane math (the real functions, transpiled in-memory) |
| `pnpm check:*` × 27 | see §2.2 | static conformance + `check:build` (a real `vite build` ×4) |
| `pnpm prove` | file-mode prober | cross-system topology invariants; exits non-zero on `drift` |

The Python half needs `python3` + `python-jose` (pinned `<3.6.0`).

### 2.2 Individual conformance gates

| Command | Asserts |
|---------|---------|
| `pnpm check:tokens` | jkAuth's static `jkos-tokens.css` mirror + jkos-deploy's mirror are byte-identical to canonical `hub.css` (regen: `pnpm --filter @jkos/jkauth sync:tokens`, `node jkos-deploy/scripts/sync-tokens.mjs`); plus `test/tokens-parity.mjs` — paper/dark accent-family SET parity + CRT knob ownership. |
| `pnpm check:nginx` | All four generated files (`weave-proxy.conf`, `weave-proxy-staging.conf`, `apps-generated.conf`, `apps-generated-staging.conf`) match what `infra/nginx/gen-nginx-weave.mjs` derives from the manifest. Fix = regenerate, never hand-edit. |
| `pnpm check:responsive` | All `@media` bounds equal `packages/design/responsive/breakpoints.ts`; `MEDIA` derives from `BREAKPOINT_MAX`; tap-target floor on the right primitives. |
| `pnpm check:drag` | The drag-unification invariants (one `usePointerDrag` primitive, no legacy HTML5-DnD reintroduction). |
| `pnpm check:cards` | Kit purity: no app ids, no host CSS classes, no `` `${x}NN` `` alpha-concat inside `@jkos/cards`/`@jkos/ui` (`withAlpha` is the one blessed path). |
| `pnpm check:hud` | ORDECK HUD doc validity + `mergePublished` idempotency, using the REAL healer. Also a fleet tool: `node apps/ordeck/scripts/check-hud-doc.mjs <file.json>` validates a doc/profile/DB export; `--live` checks the deployed profile. |
| `pnpm check:docker` | `test/dockerfile-inject.mjs` — every app Dockerfile that does a frontend build after `COPY . .` re-runs `pnpm install` first, so an injected workspace dep (e.g. `@jkos/weave`) picked up post-copy doesn't build against a stale manifest-only install. Broke papyros's wave-6 deploy (2026-07-09) before this gate existed. |
| `pnpm check:routine` | `test/routine-spec.mjs` — BeigeBoard's routine spec exists twice (the CommonJS engine that writes every occurrence's prescription, and a TS mirror that renders the forge's live preview); drives both through the same matrix of documents × cycles and compares what they actually produce, since a mirror that's quietly drifted is worse than none and text isn't the contract. |
| `pnpm check:async-view` | `test/async-view.mjs` — `@jkos/ui` exports `AsyncView` (the loading/error/empty triad on one component, re-exported from the barrel, decoupled from `@jkos/auth-client`/`@jkos/weave`) instead of each view hand-rolling its own triad. |
| `pnpm check:overlay` | `test/overlay-panel.mjs` — BeigeBoard's detail panel stays a grid-independent overlay (no fill-mode transform, no explicit `grid-row`/`grid-column`). Regression gate for a bug that shipped twice from the same root cause. |
| `pnpm check:design` | `test/design-page.mjs` — `staging.jkos.net/design` (a built snapshot inlining `hub.css`/`player-ui.css`) isn't stale against the live token files, and demos every top-level class `hub.css` defines. |
| `pnpm check:fields` | `test/fields.mjs` — every input in the suite routes through the one `.jk-field` primitive, not an app-local input dialect; `appearance` is reset everywhere a control is drawn by hand. |
| `pnpm check:scroll` | `test/scrollbar.mjs` — the drawn scrollbar hairline renders in BOTH real engines. `@supports selector(::-webkit-scrollbar)` is true in Gecko (Selectors-4 parses unknown `-webkit-` pseudos as valid rather than dropping the rule), so a webkit-only guard silently loses Firefox; this asserts against real headless Chromium + Firefox, not a CSS text-scan. |
| `pnpm check:text` | `test/text-purity.mjs` — every tracked source file the rest of the gate's text-scans depend on (`check:drag`, `check:cards`, `check:tokens`, `check:design`, `check:async-view`, `check:overlay`, the prober's probes) is actually readable as text; a raw NUL byte marks a file binary to git and invisible to `grep -r`, so a real violation inside it would otherwise pass forever. |
| `pnpm check:auth` | `test/auth-single-source.mjs` — ORDECK/PapyrOS/KourOS all share `@jkos/auth-client`'s `useAuthProvider` (identity check → refresh-cookie rotation → declare logged-out) instead of three independently-copied bootstrap sequences, one bug fix away from silently logging out returning users in the un-fixed copies. |
| `pnpm check:today` | `test/today.mjs` — ONE definition of "today", and of WHERE the caller is (D5/XC-4). `callerDay`/`callerZone`/`zonedParts` are the single reader; `authFetch` stamps `X-JKOS-TZ` on every suite request so no app opts in. ⚠️ **A missing scan root is a FAILURE here** — it once named `apps/lazuros/backend/src`, which has never existed, swallowed the ENOENT and scanned a whole backend as zero files. 107 files, up from a number that was never the truth. |
| `pnpm check:refs` | `test/refs.mjs` — routine identity and reachability (D7). The occurrence `ref` is the authority in SQL, not just in prose; every `ext_ref` scheme is declared by the app that writes it; the horizon reconcile is bounded per user per caller-day and reachable by ANY caller including a delegated service token. |
| `pnpm check:binding` | `test/binding.mjs` — ONE binding model across the read half (`WidgetSpec`) and the write half (`TriggerDef`) (WV-2). ⚠️ Asserts `resolve()` DELEGATES rather than pattern-matching the old body — a first pass sailed past a re-hand-rolled copy that differed only by a cast. |
| `pnpm check:token-identity` | `test/token-identity.mjs` — **Stage F's step zero**: what all 152 `:root` tokens ACTUALLY compute to on both faces, measured by a real headless Chromium and pinned in `packages/design/tokens/computed-baseline.json`. ⚠️ **Every other gate here is a text scan and none of them can tell you a colour changed** — rewrite `--hub-amber` from `#ffb000` to `#ffb100` and the whole repo stays green. Records the substituted text AND the used value after `color-mix()` is evaluated, so a mix percentage cannot move invisibly. A rename that PRESERVES the value passes and is reported as a rename (that is the edit Stage F is made of); a surviving name whose value moved, an orphaned name, or a genuinely new token fails. Accept an intended change with `--update` and review the JSON diff. Skips without a browser. |
| `pnpm check:pulsarmap` | `test/pulsarmap.mjs` — the pure math under the pulsarmap renderer (ALGORITHMS.md §9): the reveal index, the plan a frame produces, and the pan — and, for the 3-D renderer (`components/ridges3d`), the texture layout (every cell of a wrapped 2,500-row mesh round-trips its texel), the shader's `(row, band)` and texel arithmetic scanned against the TypeScript that mirrors it, the follow camera, the orbit clamps and the solved spring. Scans the shader for any per-track `max`/`min`/gain. ⚠️ **Every failure mode here is silent.** A reveal driven off the 2.0 s *target* rather than the mesh's derived 1.9969 s row duration is a whole row out by minute ten and reads as a stylistic choice; a seek backwards that appends instead of repainting draws the second half of the song over the first. Also scans the module for `setInterval`/`Date.now`/`requestAnimationFrame` — the reveal is driven by the media element's `currentTime` by its caller, never by a clock of its own. |
| `pnpm check:vibespace` | `test/vibespace.mjs` — the pure math under the vibe space (`components/vibespace/geometry.ts`, ALGORITHMS.md §9 M6): the packed payload decoder, the density field, and the gestures. ⚠️ **Almost every failure here still draws a beautiful cloud.** Asserts inferred album centroids never feed the density, the tone map is SHARED across slices (a sparse calm cluster stays faint beside a dense intense one), and G7 — the opacity mixed from two slices stays within 0.02 of the exact continuous field at every slice interval (measured, on the production 48 × 48³ settings). Also the brightness ramp is one hue ordered by lightness in both faces, the camera keeps the cube in a portrait frame at every yaw, and the module holds no clock or DOM. |
| `pnpm check:runes` | `test/runes.mjs` — the pure stroke recognizer under KourOS's rune layer (`apps/kouros/src/gestures/rune.ts`): flick vs dial vs corner, the dial's sign and its zero, and the noise floor. ⚠️ **A misread rune is silent and destructive** — it fires the wrong transport command and the only evidence is that the music changed. Pins the property the grammar rests on: classification is a fold over the WHOLE stroke, so a throw that curls stops being a flick and never was one (lift-to-commit). Also asserts the live preview and the committed command come from the same function, and scans the module for clocks and DOM. |
| `pnpm check:columns` | `test/columns.mjs` — declared column invariants **against the REAL database** (E3). Boots it, runs every migration, interrogates `sqlite_master`; `writeOnce` is checked BEHAVIOURALLY by writing twice past every route. ⚠️ A trigger that still exists but whose `WHEN` no longer matches passes a shape check and fails this one. |
| `pnpm check:rulings` | `test/rulings.mjs` — the four contract rulings (E6), because a ruling nothing enforces is prose: `resolves` over `returns` for an async binder, ONE paging default/max, an unknown doc version failing CLOSED, a DERIVED idempotency key, and the key DECLARED on every door that is not idempotent by construction (`create*`, async, write-back targets). ⚠️ Sameness is the assertion, not presence — a random key satisfies "has a key" and defeats the mechanism. |
| `pnpm check:scopes` | `packages/suite-manifest/scripts/gen-scopes.mjs --check` — **the scopes jkAuth may grant, derived from what capability docs declare** (D1). Regenerates `packages/suite-manifest/scopes.generated.js` in memory from every `BACKEND_DOCS` module and fails if the committed copy is stale; also fails on a write capability that declares no scope, a scope naming another app or an unknown verb, and an `APPS` row with `capabilities: true` but no doc module. Rerun without `--check` to regenerate. ⚠️ A new scope is a jkAuth REDEPLOY — the accepted cost of a build-time manifest. |
| `pnpm check:policy` | `test/policy.mjs` — no route re-types a role comparison; jkAuth's authorization lives in one policy module. ⚠️ **This gate's regex once matched nothing in the entire service** (it required a leading `.` and the real comparisons are bare), so it passed because it could not see a single case. That is what a permanently-zero detector looks like from outside. Exceptions are pinned to EXACT counts now. |
| `pnpm check:secrets` | `test/secrets.mjs` — no secret material in TRACKED files (what would be published), paired with an assertion that `.gitignore` still excludes `.env`/`*.pem`/`*.key`. ⚠️ It only ever matched VENDOR-SHAPED tokens until a real Qobuz account password sat in tracked source as a plain `*_PASSWORD =` assignment; that shape is caught now. |
| `pnpm check:audit` | `test/supply-chain.mjs` — dependency advisories. **Floor: `high`** (raised 2026-09-16): a CRITICAL or HIGH fails the gate; moderates and lows are printed and do not. Transitive fixes go in `pnpm-workspace.yaml` as range-scoped floors, never via `pnpm update --depth Infinity` (it rewrites unrelated workspace links). |
| `pnpm check:build` | `vite build` for ORDECK / BeigeBoard / PapyrOS / KourOS (~5 s). ⚠️ **Added because the gate could be entirely green while an app was unbuildable.** BeigeBoard's production build was dead — `@jkos/routine-spec` missing from `commonjsOptions.include`, so rollup could not synthesize its CJS default export — and every other link in the chain passed, because none of them ran `build`. Verified to go red when the include is removed. |
| `pnpm check:docs` | `test/docs.mjs` — **the docs inventory covers the gate.** Every test file the chain actually runs is named in TESTING.md, every `check:*` script is named here, and every repo path the docs cite resolves. ⚠️ **Counts are deliberately NOT pinned** — that would redden the gate on every added assertion. A whole suite going unmentioned is the defect that hides, and it had: eight suites and ~170 assertions ran on every green gate while appearing in no document. |

### 2.3 The prober — live and write modes

```bash
pnpm prove                                            # file mode (in the gate)
node packages/suite-prober/prove.mjs --json           # machine report
node packages/suite-prober/prove.mjs --live https://staging.jkos.net   # deployed-stack smoke
#   add --token <jwt> (or PROBE_TOKEN=) to check the authed directory + gated docs
node packages/suite-prober/roundtrip.mjs --live <base> --token <jwt>   # live WRITE check
#   safe on staging — only touches its own ext_ref:'prober:*' rows, sweeps them after
```

`prove --live` catches "green in git, dead in prod": health 404s at the edge, served docs
failing `checkDocShape`, registry drift, an admin gate that stopped 401ing. Exits non-zero
on drift, so it can gate a post-deploy smoke.

Findings classify as `drift` (two sources disagree — fails) · `consolidate` · `gap` ·
`info` · `ok`. To extend: a new source-of-truth file → `SOURCES` in
`packages/suite-prober/src/sources.mjs`; a new app's docs → `BACKEND_DOCS` same file; a new
invariant → drop `NN-name.mjs` in `src/probes/` (auto-loaded).

### 2.4 Per-app tests (localize a gate failure)

```bash
pnpm --filter @jkos/jkauth test                # auth smoke + lifecycle + multiuser + security
pnpm --filter @jkos/jkauth test:contracts      # codes/issuer/python bridge only
pnpm --filter @jkos/beigeboard-backend test    # all seven BB smokes
pnpm --filter @jkos/lazuros-backend test       # queue/providers/writeback/worker-e2e
pnpm --filter @jkos/files test                 # Range-stream + path-containment (29 asserts)
pnpm --filter @jkos/papyros-backend test       # probe/library/playback/meta/history smokes, 208 asserts (needs ffprobe + ffmpeg)
pnpm --filter @jkos/kouros-backend test        # library/playback/history/discover smokes, 144 asserts
pnpm --filter @jkos/player test                # timeline/queue/backend/engine (core+backend+engine)
pnpm --filter @jkos/weave test                 # weave + lego
python3 apps/lazuros/worker/test/worker.smoke.py   # worker unit half (19, mocked State node)
bash jkos-deploy/scripts/selftest.sh           # deploy-pipeline dry-run (read-only; SKIPs cleanly without docker/openssl)
```

### 2.5 Claude Code skills

| Skill | Use it when |
|-------|-------------|
| `/suite-health` | Anything red or suspicious. Runs the check layers in order (typecheck → gate → localized suspects → `prove --live`) and maps failure signatures to known causes/fixes (numeric-sub, nginx drift, pnpm-copy staleness, ORDECK dev, live-gate exposure, `CALENDAR_ENC_KEY`). |
| `/new-tester` | Adding any test. The house-pattern playbook: shape picker (boot-real-server smoke · transpile-pure-logic unit · text-scan gate · prober probe · node↔python bridge), the non-negotiables (throwaway port + temp DB, dev-stub auth, real HTTP, async-spawn trap), and the gate-wiring checklist. |

---

## 3 · Scaffolding, infra & deploy

| Action | How |
|--------|-----|
| **Create a new app** | `pnpm new-app <id> [--name "Display Name"] [--port 3010]` — emits a weave-wired backend (a `defineCollection` + `.mount`), a themed frontend, root-context Dockerfile + compose entries, registers the app in the manifest (registry/prober derive), and — since it sets `edge:'standard'` — REGENERATES all four nginx includes itself (no manual `standalone.conf` edit needed; `apps-generated*.conf` picks it up). Then: `pnpm install`, fill `apps/<id>/.env`, deploy, apply the nginx change (recreate if the mount set changed, else the deploy pipeline's self-healing `reload_nginx` — OPERATIONS.md § Nginx config). `pnpm new-app <id> --remove` undoes it. |
| **Regenerate nginx peer confs** | `node infra/nginx/gen-nginx-weave.mjs` (then `--check`). All four generated files (`weave-proxy.conf`, `weave-proxy-staging.conf`, `apps-generated.conf`, `apps-generated-staging.conf`) are GENERATED — never hand-edit; `standalone.conf` is hand-written. Configs are bind-mounts, so content-only changes go through the deploy pipeline's self-healing `reload_nginx` (detects a missing mount and RECREATES instead of restarting — see OPERATIONS.md § Nginx config). Manual intervention: `cd infra/nginx && docker compose up -d` (recreate). A bare `docker restart standalone-nginx` is UNSAFE if the mounted conf set has drifted — it can take prod+staging down. |
| **Regenerate token mirrors** | `pnpm --filter @jkos/jkauth sync:tokens` and `node jkos-deploy/scripts/sync-tokens.mjs` after any `hub.css` change. |
| **Deploy staging / promote prod** | `staging.jkos.net/deploy/` (admin-gated console). Promote ships the exact commit staging just ran (`PROD_BRANCH=staging`). Details + cold-start: [OPERATIONS.md](OPERATIONS.md). |
| **Break-glass (prod jkAuth down)** | `curl -X POST -H "Authorization: Bearer $BREAK_GLASS_TOKEN" https://staging.jkos.net/deploy/…` — only works while jkAuth is unreachable; inert otherwise. Host-env only. See OPERATIONS.md § Break-glass. |
| **Deploy-pipeline self-test** | `bash jkos-deploy/scripts/selftest.sh` — read-only validation of the recovery path (scripts parse, compose configs validate, nginx conf loads, break-glass gates hold). |
| **Fleet-check HUD docs** | `node apps/ordeck/scripts/check-hud-doc.mjs [<file.json> \| --live]`. |

---

## 4 · Cross-cutting gotchas (the ones that bite)

| Gotcha | Rule |
|--------|------|
| pnpm workspace copies | After editing `packages/*`: `pnpm install`, or consumers keep the stale copy. |
| ORDECK vite dev | Broken (CJS `codes.js`). Verify via `pnpm --filter @jkos/ordeck build` + `preview`. |
| nginx bind-mount inodes | `nginx -s reload` re-reads the stale inode — useless after `git reset`. Content-only changes: the deploy pipeline's `reload_nginx` handles it (and self-heals a missing bind-mount by recreating). Manual fix when the mounted conf set itself has drifted (e.g. a new generated `.conf` file the running container never mounted): RECREATE, `cd infra/nginx && docker compose up -d` — a bare `docker restart standalone-nginx` cannot add a bind-mount and, if `standalone.conf`'s new inode `include`s a file the container doesn't have mounted, crashes nginx with `[emerg] open() failed`, taking prod+staging down. Details: OPERATIONS.md § Nginx config. Prod deploys never touch nginx (`MANAGE_NGINX=0`); new peers are inert in prod until a manual recreate. |
| Docker context | Every JS image builds from the **repo root** so `@jkos/*` resolves. Never per-app context. |
| BeigeBoard backend is CommonJS | It `require`s `@jkos/weave/server` (dual-build). Frontend packages are ESM/TS — no mixing. |
| `CALENDAR_ENC_KEY` lifecycle | Adding a key later is safe (dual-read); removing/changing one after encryption breaks those rows. Treat as permanent per instance. |
| Numeric JWT `sub` | jkAuth mints `String(sub)` everywhere; the Python verifier is strict again. Never re-add `verify_sub:False`; keep `python-jose <3.6.0`. The gate catches regressions. |
| The repo path has a space | Quote `"/media/jag/The Forge/jkOS"` in every shell command. |
