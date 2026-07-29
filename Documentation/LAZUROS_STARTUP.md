# LazurOS — Tier 0 / 1 / 2 Bring-Up Guide (Luna + Emily)

How to take LazurOS from "code-complete, Phases 0–6 + 8" to serving live inference across your
two-node setup. This is the live bring-up (the [ToDo §1](ToDo.md) unblockers plus Phase 5), not
the later BeigeBoard AI rebuild (§1d).

**Verified against the repo (2026-07-13).** Every field name, port, env var, path, and command
below was read from the actual source — `deployment.jag.json`, `backend/server.js`,
`backend/docs.js`, `backend/providers/contracts.md`, `docker-compose.yml`,
`docker-compose.staging.yml`, `worker/worker.py`, `worker/lazuros-worker.service`,
`lib/queue.js`, `infra/nginx/gen-nginx-weave.mjs` — not inferred.

**The two things that change your mental model:**

1. `deployment.jag.json` already exists and is committed, with three placeholders blank. You fill
   `TODO_EMILY_MAC` + `TODO_EMILY_IP` ×2 and copy it to `deployment.json`. You are not authoring
   config from scratch.
2. **The State node is NOT part of the staging stack.** It is a `network_mode: host` compose
   project of its own. `docker compose -f docker-compose.staging.yml up -d --build` will *not*
   start it. See Phase E — this is the step most likely to waste an hour.

---

## The map

The `tiers` array is the real escalation ladder. Jag's committed config has three tiers, and
tiers 0 and 1 both sit on the same `edge` backend:

| Tier | `id` / label | `computeBackend` | Machine | Runtime | Reachability | `fallback` |
|------|--------------|------------------|---------|---------|--------------|-----------|
| 0 | Local Triage | `edge` | **Luna** (RX 560) | Ollama, small model | `always-on` | → 1 |
| 1 | Edge Web Search | `edge` | **Luna** | DDGS / SearXNG (no Ollama) | `always-on` | → 2 |
| 2 | Heavy Compute | `emily` | **Emily** (RTX 3080) | Ollama, large model | `wol` | `null` |

The local always-on node is keyed **`edge`**, not `luna`. There is no `luna` key. Luna *is* the
edge node and the State node. Do not introduce a third name.

STT, TTS, embedding, and web search are **top-level State-node slots**, not per-tier and not
per-node. They live once at the root of `deployment.json`, and Jag's committed values are:

| Slot | Provider | `baseUrl` | Notes |
|------|----------|-----------|-------|
| `stt` | whisper | `http://localhost:8000` | `runtime: "whisper.cpp-vulkan"`, `model: "base"` |
| `tts` | piper | `http://localhost:5000` | `voiceModel: "glados"` |
| `embedding` | local | `http://localhost:11434` | **Ollama's port** — see Phase A |
| `webSearch` | ddgs | `http://localhost:8001` | SearXNG factory also ships |

### What runs where

**The State node runs on Luna only.** The `lazuros` container (`container_name: lazuros`,
`network_mode: host`, port **8080**) routes, queues, tracks jobs, and does delegated write-back.
It never runs inference. Do not put the container on Emily. Emily runs a worker plus Ollama, that
is all.

**One worker per compute node, installed as a systemd unit** (not a container, not a boot hook).
The shipped unit is `apps/lazuros/worker/lazuros-worker.service`, which execs
`/usr/bin/python3 /opt/lazuros/worker.py` with `EnvironmentFile=/opt/lazuros/.env`. Same
mechanism on both nodes.

- **Luna worker** serves tier 0 edge inference.
- **Emily worker** starts on boot after a WoL wake, drains, posts back, then Emily idle-shuts.

**The worker does not go through nginx.** The State node mounts two separate surfaces:
`/api/lazuros/*` (edge-exposed, JWT-gated, proxied by nginx) and **`/internal/*`** (the worker
API, bearer-gated by `LAZUROS_INTERNAL_TOKEN`, **not proxied at the edge at all**). Emily's
worker talks to `http://<LUNA_IP>:8080/internal/jobs` **directly over the LAN**. That means host
port 8080 is reachable on your LAN with only the bearer token in front of `/internal` — keep the
token strong and the LAN trusted.

---

## Prerequisites (the ToDo §1b unblockers)

The first two block everything — no worker will even start without them.

- [ ] **`prompts.json` authored** (per node). One Python `str.format()` template per capability.
      Placeholders are **not free** — they must match the capability's declared body fields (table
      in Phase D). A missing key raises at render time.
- [ ] **`models.json` authored** (per node). Flat `{capability: model-tag}`. The shipped template
      is all literal `REPLACE_WITH_*` values; `worker.py` raises `ValueError` on a capability
      missing from the map.
- [ ] **Luna Ollama on GPU.** `ollama ps` shows the RX 560 (Vulkan, not ROCm). Phase A.
- [ ] **Embedding model pulled** on Luna's Ollama (`bge-small-en-v1.5`). Phase A.
- [ ] **Whisper server** on 8000 (OpenAI-compatible `/v1/audio/transcriptions`).
- [ ] **Piper server** on 5000, GLaDOS voice sourced.
- [ ] **DDGS sidecar** (or SearXNG) on 8001.
- [ ] **Emily static IP + MAC**, WoL in BIOS **and** NIC, idle-shutdown set.
- [ ] **jkAuth service-client enrollment** (Phase E.2).

---

## Phase A — Tier 0 inference on Luna (Ollama, RX 560)

GPU backend selection is entirely infra-level. No LazurOS code branches on ROCm vs Vulkan vs
CUDA (the only trace in config is the informational `stt.runtime` string). So the binary choice
is yours at the OS level, and it matters:

The RX 560 is Polaris. ROCm dropped Polaris, so **Ollama must use its Vulkan backend**, and the
container needs `/dev/dri` passed through.

```bash
docker run -d --name ollama-luna \
  --device /dev/dri:/dev/dri \
  -e OLLAMA_HOST=0.0.0.0:11434 \
  -v /mnt/Luna/Backends/ollama:/root/.ollama \
  ollama/ollama

docker exec ollama-luna ollama pull <small-model>     # the tier-0 router model
docker exec ollama-luna ollama pull bge-small-en-v1.5  # the embedding slot — see below
docker exec ollama-luna ollama ps                      # must list the RX 560, not CPU
```

Reality check: the RX 560 has 2–4 GB VRAM, so tier 0 is limited to small quantized models.
Anything heavier escalates to Emily. That is the design, not a fault. If `ollama ps` shows CPU
only, Vulkan is not loading, and **tier 0 is fake until you fix it.**

**Embeddings are Ollama, not a separate server.** The `embedding` slot's `baseUrl` is
`http://localhost:11434` and `createLocalEmbeddingProvider` POSTs to **`/api/embeddings`** — i.e.
Luna's Ollama. So the only work is `ollama pull bge-small-en-v1.5`. Nothing extra to run.

**STT (whisper), 8000.** OpenAI-compatible server exposing `/v1/audio/transcriptions`.
**TTS (piper), 5000.** HTTP piper server with the GLaDOS ONNX voice loaded.

---

## Phase B — Tier 1 web search on Luna

Not Ollama. Tier 1 routes web-search intents to the `edge` backend, and the `ddgs` provider on
8001 fulfills them (the provider ships both a DDGS and a SearXNG factory; Jag's config points at
ddgs).

```bash
curl -s "http://localhost:8001/search?q=test"
```

---

## Phase C — Tier 2 on Emily (Ollama, RTX 3080, WoL) + the workers

The 3080 is NVIDIA, so Ollama uses CUDA natively. No backend flags.

**Network + wake:**

1. DHCP reservation so Emily's IP is stable.
2. Wake-on-LAN enabled in BIOS **and** the NIC (`ethtool -s <if> wol g`, made persistent).
3. Record MAC and IP → they fill `TODO_EMILY_MAC` / `TODO_EMILY_IP` in `deployment.jag.json`.
   `computeBackend.js:34` hard-throws on a malformed MAC, and a test asserts exactly that.
4. Idle-shutdown so Emily sleeps when the queue is empty.

**Ollama:**

```bash
ollama pull <large-model>
ollama ps                                 # confirm the 3080 (CUDA)
```

**Worker install (identical on both nodes).** Stdlib-only Python 3 — no pip, no venv, no Docker.
The unit reads `EnvironmentFile=/opt/lazuros/.env`, so **that file must exist or systemd refuses
to start the service.** Note the source files are `*.example.json` and get **renamed** on copy:

```bash
# from the repo checkout, on the node you're installing:
cd "<repo>/apps/lazuros/worker"

sudo mkdir -p /opt/lazuros
sudo cp worker.py                  /opt/lazuros/worker.py
sudo cp models.example.json        /opt/lazuros/models.json     # then FILL IT IN
sudo cp prompts.example.json       /opt/lazuros/prompts.json    # then FILL IT IN
sudo cp .env.example               /opt/lazuros/.env            # then FILL IT IN
sudo chmod 600 /opt/lazuros/.env                                # it holds the internal token

sudo cp lazuros-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lazuros-worker
journalctl -u lazuros-worker -f    # expect: "[worker] up — state=… ollama=…"
```

**Worker env (`/opt/lazuros/.env`) — exact names, real defaults:**

| Var | Default in `worker.py` | On **Emily** set to | On **Luna** |
|-----|------------------------|---------------------|-------------|
| `LAZUROS_STATE_URL` | `http://localhost:8080` | **`http://<LUNA_IP>:8080`** — localhost only works on Luna | leave default |
| `LAZUROS_INTERNAL_TOKEN` | none — **hard-exits if unset** | must equal the State node's `LAZUROS_INTERNAL_TOKEN` | same value |
| `LAZUROS_OLLAMA_URL` | `http://localhost:11434` | Emily's own Ollama → localhost is correct | Luna's Ollama |
| `POLL_INTERVAL_MS` | `2000` | leave | leave |
| `LAZUROS_MODEL_MAP` | `/opt/lazuros/models.json` | leave | leave |
| `LAZUROS_PROMPT_MAP` | `/opt/lazuros/prompts.json` | leave | leave |

The internal token goes to the State node **only** (`STATE_HEADERS`); it is never sent to Ollama
(`RUNTIME_HEADERS` carry no token). That leak was found and fixed — don't reintroduce it.

Each node ships **only the capability slice it serves**: Luna's `models.json` / `prompts.json`
carry the tier-0 capabilities, Emily's carry the heavy ones. A capability present in one node's
map and absent from the other's is normal.

Emily does **not** need the `docker` group. That ToDo item was only ever about building lazuros
images on Emily during dev. The tier-2 worker is plain Python plus Ollama.

---

## Phase D — the config files

### 1. `deployment.jag.json` → `deployment.json` (State node, Luna)

The file exists and is committed. Fill the three Emily blanks, then copy it to the gitignored
runtime name the container bind-mounts:

```bash
cd "/media/jag/The Forge/jkOS/apps/lazuros"
# edit deployment.jag.json: replace TODO_EMILY_MAC (×1) and TODO_EMILY_IP (×2)
cp deployment.jag.json deployment.json     # gitignored, bind-mounted :ro
```

> **Use `deployment.jag.json`, not `deployment.example.json`.** The example config is **not yet
> asserted to validate** against `validateDeploymentConfig` (ToDo §1.2 is exactly that gap), so
> it can waste your time. The `.jag.json` file is the real one.

Real committed shape (top level):

```jsonc
{
  "name": "jag-luna-emily",
  "computeBackends": {
    "edge":  { "kind": "always-on",
               "inference": { "provider": "ollama", "baseUrl": "http://localhost:11434" } },
    "emily": { "kind": "wol",
               "mac": "TODO_EMILY_MAC",
               "healthUrl": "http://TODO_EMILY_IP:11434/",
               "inference": { "provider": "ollama", "baseUrl": "http://TODO_EMILY_IP:11434" } }
  },
  "tiers": [
    { "id": 0, "label": "Local Triage",    "computeBackend": "edge",  "triggers": ["local-pipeline","semantic-search","answered"], "fallback": 1 },
    { "id": 1, "label": "Edge Web Search", "computeBackend": "edge",  "triggers": ["needs-web-context"],                           "fallback": 2 },
    { "id": 2, "label": "Heavy Compute",   "computeBackend": "emily", "triggers": ["needs-heavy-compute"],                         "fallback": null }
  ],
  "stt":       { "provider": "whisper", "baseUrl": "http://localhost:8000", "model": "base", "runtime": "whisper.cpp-vulkan" },
  "tts":       { "provider": "piper",   "baseUrl": "http://localhost:5000", "voiceModel": "glados" },
  "embedding": { "provider": "local",   "baseUrl": "http://localhost:11434", "model": "bge-small-en-v1.5", "table": "local_vectors" },
  "webSearch": { "provider": "ddgs",    "baseUrl": "http://localhost:8001" },
  "models": {
    "router": "llama3.2:3b-instruct-q8_0",
    "heavy": { "parse-task": "…", "breakdown-goal": "…", "parse-document": "…", "widget-generate": "…" }
  }
}
```

Hard rules from `providers/contracts.md`, enforced at boot:

- The address field is **`baseUrl`**, always. No `endpoint` alias, no localhost fallback. A
  malformed or missing `baseUrl` fails at **startup naming the slot**, never mid-request.
- WoL backend fields are **`mac`** and **`healthUrl`** (not `probeUrl`). `healthUrl` is what
  `probe()` hits; `wake()` broadcasts the magic packet to `mac`.
- `computeBackends` keys carry **`kind: "always-on" | "wol"`**.
- `tiers[]` entries are `{ id: number, label, computeBackend, triggers: [], fallback: id|null }`.
  Capabilities target `'highest'` / `'lowest'`, never a literal tier number.
- `models.heavy` may be a **per-capability object** (as in Jag's file) or a flat string. Per-
  capability lets different heavy jobs on Emily run different models.
- Every call has a timeout; override per slot with `timeoutMs`. Probe timeout is 500 ms.

`validateDeploymentConfig` (`backend/lib/loadDeployment.js`) throws at load on: missing `tiers`,
missing `computeBackends`, a non-numeric tier `id`, a tier referencing an unknown backend, or a
malformed `baseUrl`. A boot failure will name the exact problem — read the container log first.

### 2. Node-local `models.json` / `prompts.json` (per worker — **not** the State node)

Distinct from the State node's `models` block. Each worker node ships its own flat,
capability-keyed slice. **The capability ids and their body fields are fixed by
`backend/docs.js`** — every capability is `POST`, scope `lazuros:write`:

| Capability | Path | Prompt placeholder(s) |
|---|---|---|
| `parse-task` | `/api/lazuros/parse-task` | `{text}` |
| `breakdown-goal` | `/api/lazuros/breakdown-goal` | `{goal_text}` |
| `parse-document` | `/api/lazuros/parse-document` | `{content}` |
| `widget-generate` | `/api/lazuros/widget-generate` | `{description}` |
| `query` | `/api/lazuros/query` | `{text}` |

`worker.py` renders `template.format(**payload)`. A placeholder that isn't a declared body field
raises `KeyError` at render time and the job goes `FAILED` — so the names above are exact, not
suggestions.

```jsonc
// /opt/lazuros/models.json  — { "<capability>": "<model-tag>" }
{ "parse-task": "…", "breakdown-goal": "…", "parse-document": "…", "widget-generate": "…", "query": "…" }

// /opt/lazuros/prompts.json — { "<capability>": "<str.format() template>" }
{ "query": "You are a triage router. Classify the intent of the following query and respond with JSON only.\n\nQuery: {text}" }
```

**The import-shape constraint (load-bearing).** `parse-task` and `breakdown-goal` results feed
straight into BeigeBoard via `lib/writeback.js` → `POST beigeboard/import`, which does a bare
`JSON.parse` and throws on anything else. BB's importer requires **`{items:[…]}`** (or a bare
array), each item needing a **`title`**; children nest via `children` / `kids` / `subtasks` and
**must be a non-empty array** — an explicit `children: []` reads as a *leaf task*, not an empty
goal. So the `breakdown-goal` prompt must emit nested children and **must never emit
`children: []`**. Make the templates force JSON-only output; anything conversational breaks the
write-back.

`parse-document` is **review-first by design** and is never auto-written.

---

## Phase E — deploy the State node and go live

### 1. Understand the deploy shape first (this is the trap)

LazurOS is **not a service in the staging stack.** Look at the includes:

- `docker-compose.yml` (**prod**, project `jkos-prod`) — **includes** `apps/lazuros/docker-compose.yml`.
- `docker-compose.staging.yml` (project `jkos-staging`) — **does not.** There is no
  `apps/lazuros/docker-compose.staging.yml` at all.

That is deliberate, and the nginx generator says so out loud: LazurOS is "the host-network
special case… the host gateway, not a compose service." Because it runs `network_mode: host` to
broadcast raw WoL packets, there is exactly **one** State node per host — it owns host port 8080
— and **both** edges proxy to it: prod's `/api/lazuros/` block and staging's admin-gated one both
`proxy_pass http://host.docker.internal:8080`. One node, two front doors. A second instance
would simply collide on 8080.

**Consequences:**

- `docker compose -f docker-compose.staging.yml up -d --build` **does not start LazurOS.**
- The `/deploy` console's **Deploy Staging** button doesn't either — it runs that same staging
  compose file. **Promote (prod)** *would* build it, via the prod include.
- For bring-up, drive the LazurOS compose project **directly**.

### 2. Pre-flight the bind mounts (two silent footguns)

`docker-compose.yml` bind-mounts `./deployment.json:/app/deployment.json:ro` and requires
`env_file: .env`. Before `up`:

- **`deployment.json` must already exist as a FILE.** If it doesn't, Docker helpfully creates a
  **directory** with that name, and the node dies reading it. If you've already hit this:
  `sudo rmdir apps/lazuros/deployment.json` and re-copy.
- **`.env` must exist**, or compose errors out.
- **The data dir must exist:** `mkdir -p /mnt/Luna/Backends/Production/lazuros-data` (override
  with `LAZUROS_DATA_PATH`). Stack deploys self-heal `<id>-data` dirs; a standalone `up` does not.

### 3. `apps/lazuros/.env`

Copy `apps/lazuros/.env.example` → `.env`. The real keys:

```bash
# ── Process ──
PORT=8080
DB_PATH=/data/lazuros.db
LAZUROS_DEPLOYMENT_CONFIG=/app/deployment.json
LAZUROS_ENV=production

# ── jkAuth (Weave SSO) ──
JKOS_AUTH_PUBLIC_KEY=          # RS256 PEM, \n-escaped on one line (or JKOS_AUTH_JWKS_URI)
JKOS_APP_ID=lazuros

# ── Internal worker API — the bearer BOTH workers send ──
LAZUROS_INTERNAL_TOKEN=        # openssl rand -hex 32

# ── Service identity (outbound delegated writes into BeigeBoard — Phase 6) ──
JKOS_SERVICE_CLIENT_ID=lazuros
JKOS_SERVICE_CLIENT_SECRET=
JKOS_AUTH_URL=http://jkos-auth:3100

# ── CORS ──
PORTAL_URL=https://jkos.net
AUTH_ORIGIN=https://auth.jkos.net
```

> **There is no `LAZUROS_TOKEN`.** Older docs (and `apps/sylibos`, which is out of scope) name a
> shared `LAZUROS_TOKEN` bearer "also set in BeigeBoard's `.env`". **The rebuilt LazurOS reads no
> such variable**, and BeigeBoard's AI surface was deleted on 2026-07-13 — BB holds no LazurOS
> keys at all. The only token is `LAZUROS_INTERNAL_TOKEN`, and it is State-node ↔ worker only.

### 4. jkAuth `.env` — enables delegated write-back

```bash
JKOS_SERVICE_CLIENTS=lazuros:<secret>:beigeboard:write
JKOS_DELEGATION_CLIENTS=lazuros
```

`JKOS_SERVICE_CLIENTS` format is `id:secret:scopeA|scopeB,…`. `JKOS_DELEGATION_CLIENTS` is the
comma list of client ids allowed to mint on-behalf-of tokens (the `act` claim). **Both are
required:** delegation supplies only the *who*; the client must *also* hold `beigeboard:write` to
commit. `<secret>` must equal `JKOS_SERVICE_CLIENT_SECRET` on the lazuros side. Unset
`JKOS_DELEGATION_CLIENTS` ⇒ no client may delegate, and **write-back silently cannot run.**

### 5. Bring the State node up

On Luna, from the checkout (paths with a space must be quoted):

```bash
cd "/mnt/Luna/Webhost/jkOS-staging/apps/lazuros"
docker compose up -d --build        # standalone project: jkos-prod-lazuros
docker compose logs -f lazuros      # expect: [lazuros] listening on 8080, deployment="jag-luna-emily"
```

Boot is fail-fast: a bad `baseUrl`, a malformed MAC, or an unknown tier backend throws here with
the slot named. Nothing gets past a bad config into request time.

> **Pick one owner.** `container_name: lazuros` is fixed, so once you later run the **prod** root
> compose (which includes lazuros), the two projects will fight over that name. During bring-up,
> run it standalone; when you promote, `docker compose down` the standalone project first and let
> the prod stack own it.

### 6. Recreate nginx (never bare-restart)

```bash
cd infra/nginx && docker compose up -d
```

The `/api/lazuros/` block proxies to `host.docker.internal:8080` with buffering off and a 600 s
read timeout for streamed NDJSON tokens. **The prefix is deliberately NOT stripped** (no trailing
slash on `proxy_pass`): alone among the peers, the State node registers its routes at their full
edge paths, so stripping 404s everything. Don't "fix" it to match the other blocks — the prober
(`90-nginx-coverage`) derives strip-vs-preserve from each app's capability paths and will fail
you.

### 7. Health

```bash
curl -sk https://staging.jkos.net/api/lazuros/health
# {"status":"ok","service":"lazuros","compute_online":true,"backends":{"edge":true,"emily":false}}
```

`compute_online:false` with `status:ok` is the **normal** state of a WoL deployment with Emily
asleep — the State node is up, the GPU is not. It is a warn (ORDECK's systems panel says "gpu
asleep"; the console shows an amber row), never a fault. Probes are 500 ms each, in parallel,
cached 5 s.

### 8. Start the workers

Luna's worker running (Phase C); Emily's `enable`d so it starts on boot after a wake.

### 9. Drive it from the console

**`https://staging.jkos.net/LazurOS`** — admin-gated at the edge (`auth_request`), and behind the
weaveAuth JWT gate in the app. A static page the State node serves from `backend/console/` (no
build step) whose form is **derived from `/api/lazuros/capabilities`**, so it always matches what
the node actually serves. Submit a capability and watch the job walk its states with the result
inline.

It talks to the server over the **same public HTTP contract any peer app uses**, so a green run
there is evidence about the real path. **This is the surface to prove Phase 5 on, before any app
depends on the gateway** (and before the §1d BeigeBoard AI build).

Note it is **staging-only** — there is no `/LazurOS` location in the prod conf.

---

## Verify the round-trip (Phase 5)

Submit a capability that escalates to tier 2 and watch the job walk the full machine:

```
POST /api/lazuros/<cap>   →   202 { job_id }
```

Full state set: **`PENDING`, `PENDING_WAKEUP`, `IN_PROGRESS`, `DONE`, `FAILED`.**

1. State node resolves the tier, `probe()`s Emily via `healthUrl`, finds it asleep → job
   `PENDING_WAKEUP`, broadcasts a WoL magic packet to Emily's `mac`.
2. Emily boots, its worker starts, polls `GET /internal/jobs`, and claims. The claim is atomic
   (`UPDATE … SET status='IN_PROGRESS' WHERE id=? AND status IN ('PENDING','PENDING_WAKEUP')`); a
   lost race returns **`409 ALREADY_CLAIMED`**. Both `PENDING` and `PENDING_WAKEUP` are claimable,
   so a job that woke a sleeping node still drains. `worker.py` itself doesn't know the status
   strings — the queue decides.
3. Worker runs Ollama, posts `DONE` (or `FAILED`, which is recorded and never crashes the daemon).
4. For a write capability, the **State node** (not Emily) commits into BeigeBoard as the acting
   user, via delegation. `parse-document` is review-only and is never auto-written.
5. Emily idle-shuts.

**Reaper:** `requeueStaleJobs` resets any `IN_PROGRESS` job untouched past **900 s** back to
`PENDING` on every `/internal/jobs` poll, so a worker that dies mid-job does not strand it.

Then confirm the gate and the live edge:

```bash
pnpm test:contracts
pnpm prove --live https://staging.jkos.net --token <jwt>
node packages/suite-prober/roundtrip.mjs --live https://staging.jkos.net --token <jwt>
```

---

## Corrections and gotchas

- **LazurOS is not in the staging stack.** No `apps/lazuros/docker-compose.staging.yml` exists;
  the staging compose has no lazuros include. `docker compose -f docker-compose.staging.yml up`
  and the `/deploy` **Deploy Staging** button both skip it. Run its own compose project. (Phase E.1)
- **`deployment.json` must exist as a file before `up`** — otherwise Docker creates a *directory*
  with that name and the node dies on boot.
- **There is no `LAZUROS_TOKEN`.** The only token is `LAZUROS_INTERNAL_TOKEN` (State node ↔
  worker). BeigeBoard holds no LazurOS keys — its AI surface was deleted.
- **The systemd unit hard-requires `/opt/lazuros/.env`** (`EnvironmentFile=`). Copy
  `worker/.env.example` there, or the service won't start.
- **Worker config files are renamed on copy:** `models.example.json` → `models.json`,
  `prompts.example.json` → `prompts.json`. The shipped model map is all `REPLACE_WITH_*`.
- **State node on Luna only.** Emily = worker + Ollama. Never the container.
- **Node key is `edge`, not `luna`.** WoL fields are `mac` + `healthUrl`, never `probeUrl`. The
  address field is `baseUrl`, never `endpoint`.
- **Emily's worker needs `LAZUROS_STATE_URL` pointed at Luna.** The `localhost:8080` default only
  works for Luna's own worker. `LAZUROS_INTERNAL_TOKEN` is required — the worker hard-exits without it.
- **`/internal` is LAN-only, not edge-exposed.** Only the bearer protects it.
- **`deployment.jag.json` already exists** — fill three blanks, copy to `deployment.json`. Don't
  rewrite from scratch, and don't start from `deployment.example.json` (not yet gate-validated).
- **Embeddings ride Luna's Ollama** (`/api/embeddings` on 11434) — just `ollama pull
  bge-small-en-v1.5`. No separate embedding server.
- **RX 560 = Vulkan, not ROCm** (infra choice, unenforced by code). **RTX 3080 = CUDA, native.**
- **Tier 1 is web search, not Ollama.** "Ollama on Emily and Luna" is tiers 0 and 2.
- **`prompts.json` + `models.json` gate everything.** Every server up but no prompts = no live e2e.
- **The `/api/lazuros` prefix is preserved at the edge, not stripped.** Opposite of every other
  peer block. (Phase E.6)
- **BeigeBoard has no AI any more.** Its `/api/ai/*` chat-proxy surface was **deleted**
  (2026-07-13): it called a `POST /api/chat` this LazurOS never served, and `BB_AI_ENABLED` was
  set in no compose file, so it was already dead. Phase 7 is therefore a **build**, not a cutover,
  and it is not a startup step — see [ToDo §1d](ToDo.md).

## Known code gaps — CLOSED (ToDo §1a)

All four gaps this section used to list are fixed and gate-wired: `worker.smoke.py` rides the
node gate (`backend/test/worker-py.smoke.mjs`, only skips when `python3` itself is absent); both
`deployment.example.json` and `deployment.jag.json` validate under test; the `jobs` dataset
declares and enforces `capability` + `since`; `worker.py`'s dangling `LAZUROS.md` citations were
repointed at [ARCHITECTURE.md § LazurOS](ARCHITECTURE.md). None of this blocks bring-up.
