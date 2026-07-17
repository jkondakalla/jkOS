/**
 * live.mjs — the `liveTopology(baseUrl)` adapter seam (TEST-1).
 *
 * The default topology loader (topology.mjs) reconstructs the suite from the
 * source-of-truth FILES so the prober runs in a bare checkout. This adapter does the
 * SAME reconstruction but then reaches out over HTTP to a DEPLOYED base URL and records
 * what the edge actually serves: each registry app's health probe, its capability /
 * dataset docs, the authenticated `/auth/apps` directory (when a token is supplied), and
 * an UNauthenticated hit on the admin gate. It attaches all of that as `model.live` and
 * returns the same model shape the file loader returns — so every existing probe keeps
 * running unchanged, and the live-only probes (1NN-live-*.mjs) read `model.live`.
 *
 * Read-only: every request is a GET. The live probes catch the "deployed but dead /
 * nginx block inert / registry drifted from source" class the file probes structurally
 * cannot see (they never touch the network).
 *
 *   liveTopology('https://staging.jkos.net')                  // unauthenticated
 *   liveTopology('https://staging.jkos.net', { token })        // + authed directory
 */

import { loadTopology } from './topology.mjs';

const DEFAULT_TIMEOUT_MS = 8000;

/** One GET, never throwing: returns a uniform { ok, status, body, error } record.
 *  A network failure / timeout is status 0 (the caller decides if that's drift). */
async function get(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* keep raw text */ }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the live model: the static topology + a `model.live` block of edge facts.
 * @param {string} baseUrl        deployment root, e.g. https://staging.jkos.net
 * @param {object} [opts]
 * @param {string} [opts.token]   bearer token for authed discovery (/auth/apps + gated docs)
 * @param {string} [opts.cookie]  raw Cookie header (alternative to token)
 * @param {number} [opts.timeoutMs]
 */
export async function liveTopology(baseUrl, opts = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const { token, cookie, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const model = loadTopology();

  const authHeaders = {};
  if (token) authHeaders.Authorization = `Bearer ${token}`;
  if (cookie) authHeaders.Cookie = cookie;
  const authed = token || cookie ? { headers: authHeaders, timeoutMs } : { timeoutMs };

  const live = {
    baseUrl: base,
    isStaging: /(^|\/\/)staging\./.test(base),
    authenticated: Boolean(token || cookie),
    fetchedAt: new Date().toISOString(),
    apps: {},
    directory: null,   // /auth/apps (authed) — the deployed registry
    gateUnauth: null,  // /auth/require-admin with NO credentials — must be 401
  };

  // 1. Per-app edge surfaces, driven off the registry rows (same paths Weave resolves).
  for (const app of model.apps.values()) {
    const reg = app.registry;
    if (!reg) continue;
    const rec = { id: app.id, health: null, capabilities: null, datasets: null };
    if (reg.healthPath) rec.health = await get(base + reg.healthPath, authed);
    if (reg.capabilitiesPath) rec.capabilities = await get(base + reg.capabilitiesPath, authed);
    if (reg.datasetsPath) rec.datasets = await get(base + reg.datasetsPath, authed);
    live.apps[app.id] = rec;
  }

  // 2. The authenticated suite directory (/auth/apps requires auth — 401 without a token).
  live.directory = await get(base + '/auth/apps', authed);

  // 3. The admin gate, hit with NO credentials: it must refuse (401). A 200 here means
  //    the auth_request gate is inert / bypassed — the exact "deployed but open" defect.
  live.gateUnauth = await get(base + '/auth/require-admin', { timeoutMs });

  model.live = live;
  return model;
}
