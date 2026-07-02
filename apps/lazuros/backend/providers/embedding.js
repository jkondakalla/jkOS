'use strict';
// embedding.js — EmbeddingProvider reference implementation. Real as of Phase 3.
//
// Shape: { kind, embed(text) => Promise<number[]>, dimensions: number }
//
// Backed by an Ollama-compatible /api/embeddings endpoint. The edge node already runs
// Ollama for inference, so an embedding model (bge-small, nomic-embed, …) is served
// with no extra runtime. `baseUrl` is required in the deployment config like every
// other network slot — no hardcoded localhost fallback (an address in code is a
// hardware fact, which the composability mandate forbids). `dimensions` is declared
// in config so the vector table can be sized before the runtime is live;
// bge-small-en-v1.5 is 384-dim by default.

const { normalizeBaseUrl, providerFetch } = require('../lib/http');

function createLocalEmbeddingProvider({ model, baseUrl, dimensions = 384, timeoutMs = 30_000 } = {}) {
  const base = normalizeBaseUrl(baseUrl, 'EmbeddingProvider "local"');
  return {
    kind: 'local', model, dimensions,
    embed: async (text) => {
      const r = await providerFetch(`embedding "${model}"`, `${base}/api/embeddings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
      }, { timeoutMs });
      const data = await r.json();
      return data.embedding;
    },
  };
}

module.exports = { createLocalEmbeddingProvider };
