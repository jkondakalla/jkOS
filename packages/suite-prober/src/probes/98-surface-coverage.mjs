/**
 * TEST-14 · Surface coverage — does the DECLARATION cover the CODE?
 *
 * `capability-completeness` audits the *typing* of what an app declares: are the
 * `returns` typed, do the filters carry `column`/`op`, is anything an opaque
 * `json` blob. What no probe asked until now is the prior question — **does the
 * declaration cover the routes the app actually serves?** That is exactly how
 * BB-7 walked past a green prober: BeigeBoard serves ~30 routes and declares a
 * fraction of them, and every probe was happy because everything it could see
 * was well-formed. The routes it could not see were invisible, not wrong.
 *
 * This is the highest-value class of defect here, because an app
 * that serves a surface it does not declare hands the NEXT agent — human or AI —
 * a map with roads missing. Zero cross-app traffic is the correct steady state;
 * an incomplete declaration is not.
 *
 * Method: parse each backend's mounted Express routes out of source
 * (`router.get('/items', …)`, `app.post(…)`), normalise them against the app's
 * api base, and diff against the paths its discovery doc declares. Reported as a
 * `gap` rather than failed — the level this probe has always used. ⚠️ Its
 * original reason ("closing it is Stage D item 3") is spent: Stage D is complete
 * and all four backends report full coverage. The level stays because the
 * REMAINING population is routes not yet written, and the first commit of a new
 * surface should be told about its missing declaration, not blocked by it.
 *
 * An app-private route is legitimate (health, static, an internal hook). Mark it
 * with a trailing `// app-private: why` comment on the route line and this probe
 * counts it as declared-by-exception, so the exception is visible in the source
 * rather than hidden in this file's allow-list.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT } from '../topology.mjs';
import { BACKEND_DOCS } from '../sources.mjs';

const require = createRequire(import.meta.url);

// `router.get('/items', …)` / `app.post("/x", …)` — the four verbs that carry a
// surface. `use` is deliberately excluded: it mounts middleware, not a route.
const ROUTE_RE = /\b(?:router|app)\.(get|post|patch|put|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const PRIVATE_RE = /\/\/\s*app-private\b/;

function jsFilesUnder(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...jsFilesUnder(p));
    else if (entry.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Every route the app mounts, as `METHOD /path`, plus which were marked private. */
function mountedRoutes(appDir) {
  const served = [];
  const files = [...jsFilesUnder(join(appDir, 'src')), join(appDir, 'server.js')]
    .filter(f => existsSync(f));
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      ROUTE_RE.lastIndex = 0;
      let m;
      while ((m = ROUTE_RE.exec(line))) {
        served.push({
          method: m[1].toUpperCase(),
          path: m[2],
          private: PRIVATE_RE.test(line),
          file: file.slice(REPO_ROOT.length + 1),
        });
      }
    }
  }
  return served;
}

/** The paths an app DECLARES, from its discovery module (capabilities + datasets). */
function declaredPaths(modulePath) {
  const doc = require(join(REPO_ROOT, modulePath));
  const caps = doc.CAPABILITIES?.capabilities ?? doc.CAPABILITIES_DOC?.capabilities ?? [];
  const sets = doc.DATASETS?.datasets ?? doc.DATASETS_DOC?.datasets ?? [];
  const paths = new Set();
  for (const c of caps) if (c.path) paths.add(String(c.path).replace(/\/+$/, '') || '/');
  for (const d of sets) if (d.path) paths.add(String(d.path).replace(/\/+$/, '') || '/');
  return paths;
}

/**
 * How far beneath a declared path that declaration is allowed to reach.
 *
 * ⚠️ THIS USED TO BE UNBOUNDED, and that is a BB-7 one level down. `/items`
 * covers `/items/:id` because a dataset and its item genuinely are one surface —
 * same rows, same shape, and demanding a second declaration for the singular read
 * would be noise in every app's doc. But unbounded, the same rule made `/items`
 * cover `/items/:id/deps` too, and the dependency surface is NOT the items
 * surface: different rows, a different body, its own ownership and cycle rules.
 * All three of those routes were mounted and answering before anything declared
 * them, and this probe reported the app fully covered the whole time — the exact
 * shape of the finding it exists to catch.
 *
 * One is the right number rather than zero: at zero, `/items/:id` needs its own
 * entry in every app, and a probe that demands a declaration per route stops
 * measuring coverage and starts measuring transcription. At one, a surface that
 * merely ADDRESSES a declared row is free, and a surface that adds a NOUN of its
 * own has to say so.
 *
 * Verified against a planted violation rather than assumed: a mounted
 * `/items/:id/notes/:noteId` with nothing declaring it reports as a gap here, and
 * the same plant read as "all 44 mounted routes are declared" with the depth
 * unbounded. The bound is what catches it; the rest of the probe never could.
 */
const MAX_COVER_DEPTH = 1;

/** Does a mounted route path fall under a declared path? A `:param` on either
 *  side matches exactly one segment on the other, and a declared path covers
 *  what sits at most `MAX_COVER_DEPTH` segments beneath it. */
function pathMatches(routePath, declaredPath) {
  const r = routePath.split('/').filter(Boolean);
  const d = declaredPath.split('/').filter(Boolean);
  if (r.length < d.length) return false;
  if (r.length - d.length > MAX_COVER_DEPTH) return false;
  for (let i = 0; i < d.length; i++) {
    if (d[i].startsWith(':') || r[i].startsWith(':')) continue;
    if (d[i] !== r[i]) return false;
  }
  return true;
}

// Routes every backend serves that are infrastructure rather than app surface.
// Not an allow-list of app routes — these are the same four everywhere and
// declaring them would be noise in every app's doc.
const INFRA = [/^\/health/, /^\/api\/(capabilities|datasets)$/, /^\/(capabilities|datasets)$/];

// A declared path is `/items`; the route is mounted as `/api/items`. Strip `/api`, and `/api/<this app's own id>` — LazurOS really does mount its
// id (its edge paths are bespoke: `/api/lazuros/health`), while the others serve
// bare paths behind an nginx that strips the prefix.
//
// ⚠️ It must be the app's OWN id, never "whatever the first segment is". The
// general form combined with `:param` wildcarding matched EVERYTHING:
// `/api/book/:bookId` reduced to `/:bookId`, whose single param segment matches
// any one-segment declaration, and the probe cheerfully reported all four apps
// fully covered. A green answer to a question it had stopped asking is the worst
// failure a conformance probe can have — worse than a red one, which at least
// gets looked at.
function candidates(routePath, appId) {
  const p = routePath.replace(/\/+$/, '') || '/';
  const forms = new Set([p, p.replace(/^\/api(?=\/)/, '')]);
  forms.add(p.replace(new RegExp(`^/api/${appId}(?=/)`), ''));
  return [...forms].filter(Boolean);
}

export default {
  id: 'surface-coverage',
  title: 'Surface coverage — every mounted route is declared, or explicitly app-private',

  run() {
    const out = [];
    for (const { app, module } of BACKEND_DOCS) {
      const appDir = join(REPO_ROOT, module.replace(/\/(discovery|docs)\.js$/, ''));
      let declared;
      try {
        declared = declaredPaths(module);
      } catch (e) {
        out.push({ level: 'gap', msg: `${app}: could not read declared paths — ${e.message}`, where: [module] });
        continue;
      }

      const routes = mountedRoutes(appDir);
      if (!routes.length) {
        out.push({ level: 'info', msg: `${app}: no Express routes found in source (scanner saw nothing to check)`, where: [module] });
        continue;
      }

      const undeclared = [];
      let privateCount = 0;
      for (const r of routes) {
        const forms = candidates(r.path, app);
        if (INFRA.some(re => re.test(r.path) || forms.some(f => re.test(f)))) continue;
        if (r.private) { privateCount++; continue; }
        // A declared path covers its own sub-paths (`/items` declares
        // `/items/:id` — the dataset and its item are one surface), and a `:param`
        // segment in EITHER matches one segment on the other side. That second
        // rule matters where a declaration deliberately generalises what the
        // routes spell out: `/calendar/:provider/sync` is one capability that
        // three hand-rolled routes implement, and treating the segments as
        // literals would report the generalisation as three gaps.
        const covered = forms.some(p => [...declared].some(d => pathMatches(p, d)));
        if (!covered) undeclared.push(`${r.method} ${r.path}`);
      }

      const total = routes.length;
      if (undeclared.length) {
        const shown = undeclared.slice(0, 8).join(', ');
        out.push({
          level: 'gap',
          msg: `${app}: ${undeclared.length} of ${total} mounted routes are neither declared nor marked app-private `
             + `(${declared.size} declared paths${privateCount ? `, ${privateCount} app-private` : ''}) — `
             + `invisible to anything reading the declaration: ${shown}`
             + (undeclared.length > 8 ? `, +${undeclared.length - 8} more` : ''),
          where: [module],
        });
      } else {
        out.push({
          level: 'ok',
          msg: `${app}: all ${total} mounted routes are declared or explicitly app-private `
             + `(${declared.size} declared paths${privateCount ? `, ${privateCount} app-private` : ''})`,
          where: [module],
        });
      }
    }
    return out;
  },
};
