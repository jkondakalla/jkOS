'use strict';
// inference.js — InferenceProvider reference implementations.
//
// Shape: { kind, generate(model, prompt, opts) => Promise<{ text, model }> }
//   opts: { keepAlive?: number, stream: false, maxTokens?: number }
//
// Each factory is a closure, not a constructor — a new runtime is a new function
// here plus one line in composeProviders' INFERENCE_FACTORIES. The model TAG is never
// hardcoded; it arrives as the `model` argument, read from the deployment config by
// the caller. Pathing goes through lib/http: baseUrl validated at boot, constant
// endpoint path appended, every call under a timeout (default 120s — inference is
// the slow slot; override per-slot with `timeoutMs` in deployment.json).

const { normalizeBaseUrl, providerFetch } = require('../lib/http');

function createOllamaInferenceProvider({ baseUrl, timeoutMs = 120_000 }) {
  const base = normalizeBaseUrl(baseUrl, 'InferenceProvider "ollama"');
  return {
    kind: 'ollama',
    generate: async (model, prompt, opts = {}) => {
      const r = await providerFetch('ollama generate', `${base}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, keep_alive: opts.keepAlive ?? 0 }),
      }, { timeoutMs });
      const data = await r.json();
      return { text: data.response, model };
    },
  };
}

function createOpenAiCompatInferenceProvider({ baseUrl, apiKey, timeoutMs = 120_000 }) {
  const base = normalizeBaseUrl(baseUrl, 'InferenceProvider "openai-compat"');
  return {
    kind: 'openai-compat',
    generate: async (model, prompt, opts = {}) => {
      const r = await providerFetch('openai-compat generate', `${base}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, prompt, max_tokens: opts.maxTokens ?? 1024, stream: false }),
      }, { timeoutMs });
      const data = await r.json();
      return { text: data.choices?.[0]?.text ?? '', model };
    },
  };
}

module.exports = { createOllamaInferenceProvider, createOpenAiCompatInferenceProvider };
