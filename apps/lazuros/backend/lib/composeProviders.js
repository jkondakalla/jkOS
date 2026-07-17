'use strict';
// composeProviders.js — the entire extensibility seam. Reads the deployment config
// and constructs the provider objects each tier/slot needs by looking the requested
// `provider`/`kind` up in a factory map. Adding a new inference runtime, STT engine,
// or compute-backend kind means adding ONE factory file and ONE line in the maps
// below — never touching the router, the job queue, or any route handler.
//
// Every provider is a plain object built by a factory closure (no classes, no
// `extends`, no virtual dispatch). The router calls `stt.transcribe(buf)` without
// knowing or caring which factory produced the object.

const { createOllamaInferenceProvider, createOpenAiCompatInferenceProvider } = require('../providers/inference');
const { createWhisperSttProvider, createCloudSttProvider } = require('../providers/stt');
const { createPiperTtsProvider, createKokoroTtsProvider, createCloudTtsProvider } = require('../providers/tts');
const { createLocalEmbeddingProvider } = require('../providers/embedding');
const { createSearxngWebSearchProvider, createDdgsWebSearchProvider } = require('../providers/webSearch');
const { createAlwaysOnBackend, createWolBackend } = require('../providers/computeBackend');

const INFERENCE_FACTORIES   = { ollama: createOllamaInferenceProvider, 'openai-compat': createOpenAiCompatInferenceProvider };
const STT_FACTORIES         = { whisper: createWhisperSttProvider, cloud: createCloudSttProvider };
const TTS_FACTORIES         = { piper: createPiperTtsProvider, kokoro: createKokoroTtsProvider, cloud: createCloudTtsProvider };
const EMBEDDING_FACTORIES   = { local: createLocalEmbeddingProvider };
const WEB_SEARCH_FACTORIES  = { searxng: createSearxngWebSearchProvider, ddgs: createDdgsWebSearchProvider };
const COMPUTE_BACKEND_KINDS = { 'always-on': createAlwaysOnBackend, wol: createWolBackend };

/** Build one provider from a slot config via the given factory map, or throw. */
function build(map, slot, what) {
  if (!slot) return null;
  const factory = map[slot.provider];
  if (!factory) throw new Error(`unknown ${what} provider "${slot.provider}"`);
  return factory(slot);
}

function composeFromConfig(cfg) {
  const inference = (slot) => {
    const factory = INFERENCE_FACTORIES[slot.provider];
    if (!factory) throw new Error(`unknown inference provider "${slot.provider}"`);
    return factory(slot);
  };

  const computeBackends = {};
  for (const [key, backendCfg] of Object.entries(cfg.computeBackends)) {
    const factory = COMPUTE_BACKEND_KINDS[backendCfg.kind];
    if (!factory) throw new Error(`unknown computeBackend kind "${backendCfg.kind}"`);
    // id defaults to the backend's config key, so logs name it by how the tiers reference it.
    computeBackends[key] = factory({ id: key, ...backendCfg, inference: inference(backendCfg.inference) });
  }

  const stt = build(STT_FACTORIES, cfg.stt, 'stt');
  const tts = build(TTS_FACTORIES, cfg.tts, 'tts');
  const embedding = build(EMBEDDING_FACTORIES, cfg.embedding, 'embedding');
  const webSearch = build(WEB_SEARCH_FACTORIES, cfg.webSearch, 'webSearch');

  return { computeBackends, stt, tts, embedding, webSearch, tiers: cfg.tiers };
}

module.exports = { composeFromConfig };
