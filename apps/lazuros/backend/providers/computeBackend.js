'use strict';
// computeBackend.js — ComputeBackend reference implementations.
//
// Shape: {
//   id: string,
//   probe() => Promise<boolean>,   // reachable right now?
//   wake() => Promise<void>,       // best-effort; no-op when not applicable
//   inference: InferenceProvider,  // the backend's own InferenceProvider
// }
//
// A ComputeBackend wraps an InferenceProvider with reachability/wake semantics. The
// router never names "WoL" or "always-on" — it calls probe()/wake() and lets the
// configured backend decide. A single-node deployment uses createAlwaysOnBackend for
// its only tier; Jag's deployment uses createWolBackend for the Emily node. A future
// cloud-burst backend is a new factory here + a key in COMPUTE_BACKEND_KINDS — nothing
// else in the codebase changes.

const dgram = require('dgram');

function createAlwaysOnBackend({ id = 'local', inference }) {
  return { id, probe: async () => true, wake: async () => {}, inference };
}

function buildMagicPacket(mac) {
  const bytes = mac.replace(/[:\-]/g, '').match(/.{2}/g).map((h) => parseInt(h, 16));
  const buf = Buffer.alloc(102);
  buf.fill(0xff, 0, 6);
  for (let i = 1; i <= 16; i++) Buffer.from(bytes).copy(buf, i * 6);
  return buf;
}

function createWolBackend({ id = 'remote', mac, healthUrl, inference, probeTimeoutMs = 500 }) {
  const probe = async () => {
    if (!healthUrl) return false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), probeTimeoutMs);
      const r = await fetch(healthUrl, { signal: ctrl.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  };
  const wake = async () => {
    if (!mac) { console.warn(`[wol] backend "${id}" has no mac configured, skipping wake`); return; }
    const packet = buildMagicPacket(mac);
    const socket = dgram.createSocket('udp4');
    await new Promise((resolve) => {
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(packet, 9, '255.255.255.255', () => { socket.close(); resolve(); });
      });
    });
  };
  return { id, probe, wake, inference };
}

module.exports = { createAlwaysOnBackend, createWolBackend, buildMagicPacket };
