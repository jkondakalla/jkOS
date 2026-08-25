// auth-stub.mjs — a four-endpoint stand-in for jkAuth, so KourOS can be opened on a
// workstation without running the portal.
//
// The BACKEND already degrades gracefully: weaveAuth injects a stub user when no
// JKOS_AUTH_PUBLIC_KEY is configured outside production. The FRONTEND does not —
// AuthGuard asks `${AUTH_URL}/auth/me` and redirects to the real portal on any
// answer that is not a user, so a dev run against a plain backend lands on
// auth.jkos.net instead of on the app. This is the smallest thing that satisfies it.
//
// It also serves the PREFERENCES blob, which is not incidental: theme mode, accent
// pair and the grain/halation effect switches all arrive from /auth/profile, and
// they are most of what "the glass aesthetic" means. Editing them in the app's
// settings drawer PATCHes back here and persists for the session, so both faces and
// every effect combination can be tried without a database.
//
// ⚠️ It authenticates NOTHING. It is bound to 127.0.0.1 and refuses to start if
// NODE_ENV is production.
import http from 'node:http';

const DEFAULT_PREFS = {
  theme: { mode: 'system', primary: '#4b3f8f', secondary: '#dba13c' },
  effects: { grain: true, grainStrength: 0.35, halation: true, scanLines: false, scanStrength: 0.25, artifacts: false },
  lazuros: { enabled: true },
};

export function startAuthStub({ port = 3010, origins = ['http://localhost:5173', 'http://127.0.0.1:5173'], user = {} } = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('auth-stub: refusing to run with NODE_ENV=production');
  }
  const me = {
    id: '1', email: 'design@jkos.local', name: 'Design Preview',
    avatar_url: null, role: 'admin', ...user,
  };
  let preferences = structuredClone(DEFAULT_PREFS);
  let version = 1;

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    // Credentialed CORS cannot use `*`, so the request's own origin is echoed back
    // from the allowlist — the same rule weaveCors applies on the real edge.
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

    const url = new URL(req.url, 'http://localhost');
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    switch (`${req.method} ${url.pathname}`) {
      case 'GET /auth/me':
        return json(200, { user: me });

      case 'GET /auth/profile':
        return json(200, { user: me, preferences, prefs_version: version });

      case 'PATCH /auth/profile': {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          try {
            const body = JSON.parse(raw || '{}');
            // Deep-merge one level, which is the shape every caller sends: whole
            // slices (theme / effects / lazuros), never individual keys.
            for (const [k, v] of Object.entries(body.preferences || {})) {
              preferences[k] = v && typeof v === 'object' && !Array.isArray(v)
                ? { ...(preferences[k] || {}), ...v } : v;
            }
            version++;
            json(200, { ok: true, prefs_version: version, preferences });
          } catch {
            json(400, { error: 'bad json' });
          }
        });
        return;
      }

      case 'POST /auth/refresh':
        return json(200, { ok: true });

      case 'POST /auth/logout':
        return json(200, { ok: true });

      default:
        // The settings drawer links out to /auth/dashboard; say so rather than 404.
        return json(404, { error: 'auth-stub serves /auth/me, /auth/profile, /auth/refresh and /auth/logout only' });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      port, server,
      close: () => new Promise((r) => server.close(r)),
      preferences: () => preferences,
    }));
  });
}
