'use strict';
// session/hub.js — who is connected, per listener, and a way to reach them.
//
// ⚠️ IN-MEMORY, AND CORRECT ONLY BECAUSE KourOS IS ONE PROCESS. Every KourOS
// environment is a single Node process in a single container (`container_name:
// kouros-app`, one `app.listen`, no cluster) — so every stream a user holds is in this
// Map, and a publish reaches all of them. The moment KourOS runs as TWO processes
// this silently becomes "some devices hear some events"; that deployment change must
// come with a shared bus (TRAPS.md records the assumption, and server.js's boot says
// so in the log).
//
// A connection is one open SSE response. A DEVICE may hold several (tabs of one
// browser share a device id — the client's Web Lock picks which tab plays), so
// presence is "device ids with at least one open stream".

const MAX_STREAMS_PER_USER = 20;

function createHub() {
  /** userId → Map<connId, { deviceId, write(event, data), close() }> */
  const users = new Map();
  let seq = 0;

  function conns(userId) {
    const k = String(userId);
    if (!users.has(k)) users.set(k, new Map());
    return users.get(k);
  }

  return {
    MAX_STREAMS_PER_USER,

    /** Register a stream; returns its id, or null when the user is at the cap.
     *  `close` ends it from the server's side (drop, below). */
    add(userId, deviceId, write, close) {
      const m = conns(userId);
      if (m.size >= MAX_STREAMS_PER_USER) return null;
      const id = `c${++seq}`;
      m.set(id, { deviceId, write, close });
      return id;
    },

    /** End every stream of one device — for a device the server has concluded is
     *  gone although its sockets have not said so (routes.js's report watchdog). */
    drop(userId, deviceId) {
      const m = users.get(String(userId));
      if (!m) return 0;
      const doomed = [...m.values()].filter((c) => c.deviceId === deviceId);
      for (const c of doomed) c.close();
      return doomed.length;
    },

    remove(userId, connId) {
      const k = String(userId);
      const m = users.get(k);
      if (!m) return;
      m.delete(connId);
      if (m.size === 0) users.delete(k);
    },

    /** The device ids with at least one open stream. */
    online(userId) {
      const m = users.get(String(userId));
      return new Set(m ? [...m.values()].map((c) => c.deviceId) : []);
    },

    /** Every stream of this user. */
    publish(userId, event, data) {
      const m = users.get(String(userId));
      if (!m) return 0;
      for (const c of m.values()) c.write(event, data);
      return m.size;
    },

    /** Every stream of ONE device of this user. Returns how many were reached. */
    sendTo(userId, deviceId, event, data) {
      const m = users.get(String(userId));
      if (!m) return 0;
      let n = 0;
      for (const c of m.values()) if (c.deviceId === deviceId) { c.write(event, data); n++; }
      return n;
    },

    /** For shutdown and tests. */
    size() {
      let n = 0;
      for (const m of users.values()) n += m.size;
      return n;
    },
  };
}

module.exports = { createHub, MAX_STREAMS_PER_USER };
