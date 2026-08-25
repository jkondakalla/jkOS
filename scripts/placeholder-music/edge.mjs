// edge.mjs — the ~60 lines of nginx this fixture actually needs.
//
// KourOS does not talk to its own backend at one base path. Most calls go to bare
// `/api/*`, but the `tracks` catalog goes through the weave dataset contract, whose
// base is `apiBase('kouros')` — `/api/kouros` — and the suite edge rewrites that back
// down to `/api/`:
//
//     location /api/kouros/ { rewrite ^/api/kouros/(.*)$ /api/$1 break; ... }
//
// Without that rewrite, `listTracks()` 404s and weaveClient does what it documents:
// returns []. Browse, Search, Artist and Album then render as an EMPTY LIBRARY while
// Home (which uses this app's own unprefixed routes) is full of music — a failure
// that looks like a data problem and is actually a routing one. api.ts says as much
// in its header: that path is "exercised at build+preview / prod, not `pnpm dev`".
//
// So the fixture serves the app through a front door that does the one rewrite, and
// everything reaches its backend the way it does in production: same origin, one
// port, cookies flowing, no CORS. WebSocket upgrades are forwarded too, which is
// what keeps vite's HMR working when the app half is the dev server.
import http from 'node:http';
import net from 'node:net';

/**
 * @param {{ port:number, apiPort:number, appPort:number,
 *           rewrites?: Array<{ prefix:string, to:string }>,
 *           apiPrefixes?: string[] }} opts
 */
export function startEdge({ port, apiPort, appPort, rewrites = [], apiPrefixes = ['/api/', '/health'] }) {
  const toApi = (url) => apiPrefixes.some((p) => url === p.replace(/\/$/, '') || url.startsWith(p));

  const route = (url) => {
    for (const r of rewrites) {
      if (url.startsWith(r.prefix)) return { port: apiPort, url: r.to + url.slice(r.prefix.length) };
    }
    return toApi(url) ? { port: apiPort, url } : { port: appPort, url };
  };

  const server = http.createServer((req, res) => {
    const target = route(req.url);
    const proxied = http.request(
      { host: '127.0.0.1', port: target.port, path: target.url, method: req.method, headers: req.headers },
      (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      });
    proxied.on('error', (err) => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`edge: ${target.port} unreachable (${err.code})`);
    });
    req.pipe(proxied);
  });

  // vite's HMR channel. Proxying only the HTTP half leaves the app loading and then
  // sitting behind a websocket that never connects, which reads as "dev server is broken".
  server.on('upgrade', (req, socket, head) => {
    const target = route(req.url);
    const upstream = net.connect(target.port, '127.0.0.1', () => {
      upstream.write(
        `${req.method} ${target.url} HTTP/1.1\r\n` +
        Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      port, server, close: () => new Promise((r) => server.close(r)),
    }));
  });
}
