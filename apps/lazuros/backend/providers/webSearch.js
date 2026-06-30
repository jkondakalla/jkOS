'use strict';
// webSearch.js — WebSearchProvider reference implementations (Phase 4, Tier 1).
//
// Shape: { search(query, opts) => Promise<{ results: [{ title, url, snippet }] }> }
//
// Tier 1 ("needs-web-context") fans a query out to a search backend, then the triage
// provider contextualizes the results (worker-side, same job machinery). Like every
// other LazurOS provider this is a factory → plain object selected from config; the
// router never knows whether SearXNG, a DDGS sidecar, or a future backend answered.
//
// Two reference impls ship:
//   - searxng : hits a self-hosted SearXNG instance's JSON API (no scraping, no key).
//   - ddgs    : hits a DDGS HTTP sidecar (the `ddgs`/duckduckgo_search Python lib has
//               no clean Node binding, so it runs as a tiny service returning the same
//               { results } JSON). Same shape, so config can swap between them freely.

function normalize(rows = []) {
  return rows.map((r) => ({
    title: r.title ?? r.heading ?? '',
    url: r.url ?? r.href ?? r.link ?? '',
    snippet: r.snippet ?? r.content ?? r.body ?? r.description ?? '',
  }));
}

function createSearxngWebSearchProvider({ baseUrl, safesearch = 1 } = {}) {
  return {
    kind: 'searxng',
    search: async (query, opts = {}) => {
      if (!baseUrl) throw new Error('WebSearchProvider "searxng": no baseUrl configured — set deployment.webSearch.baseUrl');
      const u = new URL(`${baseUrl.replace(/\/$/, '')}/search`);
      u.searchParams.set('q', query);
      u.searchParams.set('format', 'json');
      u.searchParams.set('safesearch', String(opts.safesearch ?? safesearch));
      const r = await fetch(u, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`searxng search failed: ${r.status}`);
      const data = await r.json();
      return { results: normalize(data.results).slice(0, opts.limit ?? 8) };
    },
  };
}

function createDdgsWebSearchProvider({ baseUrl, endpoint } = {}) {
  const root = baseUrl || endpoint;
  return {
    kind: 'ddgs',
    search: async (query, opts = {}) => {
      if (!root) throw new Error('WebSearchProvider "ddgs": no baseUrl configured — set deployment.webSearch.baseUrl');
      const u = new URL(`${root.replace(/\/$/, '')}/search`);
      u.searchParams.set('q', query);
      if (opts.limit) u.searchParams.set('max_results', String(opts.limit));
      const r = await fetch(u, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`ddgs search failed: ${r.status}`);
      const data = await r.json();
      return { results: normalize(data.results ?? data).slice(0, opts.limit ?? 8) };
    },
  };
}

module.exports = { createSearxngWebSearchProvider, createDdgsWebSearchProvider };
