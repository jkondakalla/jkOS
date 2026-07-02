'use strict';
// http.js — the ONE place LazurOS builds outbound URLs and issues outbound requests.
// Every provider (inference, STT, TTS, embedding, web search, compute-backend probe)
// goes through these two functions, so the whole gateway has exactly one pathing
// contract — same-node sidecars (Tier 0/1) and external nodes (Tier 2) alike:
//
//   - normalizeBaseUrl : a base URL is required, must parse as http(s), and is stored
//     with the trailing slash stripped. Called at FACTORY time, so a malformed
//     deployment.json fails at boot with the slot name — never mid-request.
//   - providerFetch    : every outbound call carries an AbortSignal timeout and maps
//     failures to three uniform error shapes:
//         "<what> failed: <status>"          (endpoint answered non-2xx)
//         "<what> timed out after <ms>ms"    (endpoint hung past the deadline)
//         "<what> unreachable: <cause>"      (transport error)
//
// Providers append only CONSTANT paths ('/api/generate', '/v1/audio/speech', …) onto
// the normalized base; anything dynamic (queries) goes through URLSearchParams.

function normalizeBaseUrl(raw, what) {
  if (!raw || typeof raw !== 'string') {
    throw new Error(`${what}: no baseUrl configured — set it in deployment.json`);
  }
  let u;
  try { u = new URL(raw); } catch { throw new Error(`${what}: invalid baseUrl "${raw}"`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`${what}: invalid baseUrl "${raw}" — must be http(s)`);
  }
  return raw.replace(/\/+$/, '');
}

async function providerFetch(what, url, init = {}, { timeoutMs = 30_000 } = {}) {
  let r;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(`${what} timed out after ${timeoutMs}ms`);
    }
    throw new Error(`${what} unreachable: ${e.message}`);
  }
  if (!r.ok) throw new Error(`${what} failed: ${r.status}`);
  return r;
}

module.exports = { normalizeBaseUrl, providerFetch };
