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

Ships: `createWhisperSttProvider({ model, runtime })` (local, faster-whisper /
whisper.cpp), `createCloudSttProvider({ endpoint, apiKey })`.

## TtsProvider

```js
// { synthesize(text, opts) => Promise<{ audioBuffer, mimeType }> }
```

Ships: `createPiperTtsProvider({ voiceModel })`, `createKokoroTtsProvider({ voice })`,
`createCloudTtsProvider({ endpoint, apiKey })`.

## EmbeddingProvider

```js
// { embed(text) => Promise<number[]>, dimensions: number }
```

Ships: `createLocalEmbeddingProvider({ model })` (e.g. bge-small via a local
sentence-transformers / ONNX call).

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
