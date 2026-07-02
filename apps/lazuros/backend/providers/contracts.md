# LazurOS provider contracts

> Documentation for anyone implementing a new provider. Each provider type is a
> **contract** — an input/output shape — not an implementation. Reference
> implementations satisfying each contract ship alongside this file; a deployment
> config (`deployment.json`) selects which implementation backs which slot.

These are the composability seam. Every swappable piece of LazurOS — the model that
triages requests, the STT engine, the TTS engine, the embedding model, the inference
runtime, the WoL-powered escalation target — is a **provider**: a plain object
satisfying a function-shaped contract, constructed by a `createXProvider(config)`
factory, and composed at startup by reading the deployment config (see
`../lib/composeProviders.js`).

There is no `class SttProvider`. There is no `extends`. A new provider is a new file
exporting one factory function that returns an object matching the shape below, plus
one line in the relevant factory map in `composeProviders.js`. Nothing else in the
codebase — not the router, not the job queue, not a route handler — changes.

## Pathing & transport contract (`../lib/http.js`)

Every network-backed provider — same-node sidecars (Tier 0/1) and external nodes
(Tier 2) alike — builds URLs and issues requests through **one** module, so the whole
gateway has one pathing contract:

- **`baseUrl` is the one address field.** Required, no `endpoint` alias, no hardcoded
  localhost fallback (an address in code is a hardware fact, which the composability
  mandate forbids). `normalizeBaseUrl` runs at **factory (boot) time**: it requires a
  parseable http(s) URL and strips the trailing slash, so a malformed
  `deployment.json` fails at startup with the slot name — never mid-request.
- **Constant paths only.** Providers append fixed endpoint paths (`/api/generate`,
  `/v1/audio/speech`, …) onto the normalized base. Anything dynamic goes through
  `URLSearchParams`, never string interpolation.
- **Every call has a timeout.** `providerFetch` wraps `fetch` with an
  `AbortSignal.timeout`. Defaults per slot type (inference 120s, STT/TTS 60s,
  embedding 30s, web search 15s, probe 500ms), overridable per slot with `timeoutMs`
  in `deployment.json`.
- **Three uniform error shapes**, so callers/logs never guess:
  `"<what> failed: <status>"`, `"<what> timed out after <ms>ms"`,
  `"<what> unreachable: <cause>"`.
- **Credentials are scoped to their system.** An `apiKey` goes only to its own
  provider's base; the worker mirrors this (`worker.py`: `STATE_HEADERS` with the
  internal bearer token goes only to the State node, `RUNTIME_HEADERS` — never the
  token — to the inference runtime).

So the standardized slot input is `{ provider, baseUrl, apiKey?, timeoutMs?,
…slot-specifics (model, voice, …) }`, and every provider output is exactly its
contract shape below.

## InferenceProvider

```js
// { generate(model, prompt, opts) => Promise<{ text, model }> }
// opts: { keepAlive?: number, stream: false, maxTokens?: number }
```

Ships: `createOllamaInferenceProvider({ baseUrl })`,
`createOpenAiCompatInferenceProvider({ baseUrl, apiKey })` (covers any
OpenAI-compatible local server — llama.cpp server, vLLM, LM Studio — or a hosted cloud
API as an escalation target for deployments with no second node).

## SttProvider

```js
// { transcribe(audioBuffer, opts) => Promise<{ text, language? }> }
```

Ships: `createWhisperSttProvider({ baseUrl, model, runtime })` (local, faster-whisper /
whisper.cpp), `createCloudSttProvider({ baseUrl, apiKey, model })`.

## TtsProvider

```js
// { synthesize(text, opts) => Promise<{ audioBuffer, mimeType }> }
```

Ships: `createPiperTtsProvider({ baseUrl, voiceModel })`,
`createKokoroTtsProvider({ baseUrl, voice })`,
`createCloudTtsProvider({ baseUrl, apiKey, voice })`.

## EmbeddingProvider

```js
// { embed(text) => Promise<number[]>, dimensions: number }
```

Ships: `createLocalEmbeddingProvider({ baseUrl, model, dimensions })` (e.g. bge-small
served by the edge node's Ollama).

## WebSearchProvider

```js
// { search(query, opts) => Promise<{ results: [{ title, url, snippet }] }> }
// opts: { limit?: number, safesearch?: number }
```

Ships: `createSearxngWebSearchProvider({ baseUrl, safesearch })` (self-hosted SearXNG
JSON API), `createDdgsWebSearchProvider({ baseUrl })` (DDGS HTTP sidecar). Both
normalize whatever field names the backend returns into the one
`{ title, url, snippet }` result shape, so Tier 1 never branches on which answered.

## ComputeBackend

```js
// {
//   id: string,
//   probe() => Promise<boolean>,   // reachable right now?
//   wake() => Promise<void>,       // best-effort; no-op if not applicable
//   inference: InferenceProvider,  // the backend's own InferenceProvider
// }
```

A `ComputeBackend` wraps an `InferenceProvider` with reachability/wake semantics.
`createAlwaysOnBackend({ inference })` — `probe()` always true, `wake()` a no-op — is
what a single-node deployment uses for its only tier. `createWolBackend({ mac,
healthUrl, inference })` is what Jag's deployment uses for the Emily node. A future
`createCloudBurstBackend({ inference })` would have `probe()` check an API key/quota
and `wake()` be a no-op — same contract, no code changes anywhere else.

## Why factories, not classes

Each `createXProvider(config)` is a closure. No shared base class, no `super()`, no
virtual dispatch. Strictly easier to test (call the factory, assert on the returned
object) and strictly easier to compose (an array of providers is just an array of
objects — no `instanceof`).
