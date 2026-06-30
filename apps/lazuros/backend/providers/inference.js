'use strict';
// inference.js — InferenceProvider reference implementations.
//
// Shape: { generate(model, prompt, opts) => Promise<{ text, model }> }
//   opts: { keepAlive?: number, stream: false, maxTokens?: number }
//
// Each factory is a closure, not a constructor — a new runtime is a new function
// here plus one line in composeProviders' INFERENCE_FACTORIES. The model TAG is never
// hardcoded; it arrives as the `model` argument, read from the deployment config by
// the caller.

function createOllamaInferenceProvider({ baseUrl }) {
  return {
    generate: async (model, prompt, opts = {}) => {
      const r = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, keep_alive: opts.keepAlive ?? 0 }),
      });
      if (!r.ok) throw new Error(`ollama generate failed: ${r.status}`);
      const data = await r.json();
      return { text: data.response, model };
    },
  };
}

function createOpenAiCompatInferenceProvider({ baseUrl, apiKey }) {
  return {
    generate: async (model, prompt, opts = {}) => {
      const r = await fetch(`${baseUrl}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, prompt, max_tokens: opts.maxTokens ?? 1024, stream: false }),
      });
      if (!r.ok) throw new Error(`openai-compat generate failed: ${r.status}`);
      const data = await r.json();
      return { text: data.choices?.[0]?.text ?? '', model };
    },
  };
}

module.exports = { createOllamaInferenceProvider, createOpenAiCompatInferenceProvider };
