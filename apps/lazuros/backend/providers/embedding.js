'use strict';
// embedding.js — EmbeddingProvider reference implementation. Real as of Phase 3.
//
// Shape: { embed(text) => Promise<number[]>, dimensions: number }
//
// Backed by an Ollama-compatible /api/embeddings endpoint. The edge node already runs
// Ollama for inference, so an embedding model (bge-small, nomic-embed, …) is served
// with no extra runtime — `baseUrl` defaults to the local Ollama. `dimensions` is
// declared in config so the vector table can be sized before the runtime is live;
// bge-small-en-v1.5 is 384-dim by default.

function createLocalEmbeddingProvider({ model, baseUrl = 'http://localhost:11434', dimensions = 384 } = {}) {
  return {
    kind: 'local', model, dimensions,
    embed: async (text) => {
      const r = await fetch(`${baseUrl.replace(/\/$/, '')}/api/embeddings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!r.ok) throw new Error(`embedding "${model}" failed: ${r.status}`);
      const data = await r.json();
      return data.embedding;
    },
  };
}

module.exports = { createLocalEmbeddingProvider };
