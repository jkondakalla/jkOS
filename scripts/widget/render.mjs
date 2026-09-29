// render.mjs — draw widgets with the real renderer, in a real browser, and measure them.
//
// Shared by `pnpm widget shot` (an agent looking at what it built) and
// `pnpm check:widget-render` (the gate asserting nothing ships broken):
//
//   1. build ORDECK's preview entry (apps/ordeck/preview, vite.preview.config.ts) into a
//      scratch directory — the page is never part of ORDECK's own build;
//   2. serve it, with each job at /job.json?job=<n>, each source's request answered per
//      state at /__fixture/<n>/<state>/<name> (the widget's fixtures, or the empty
//      answer for its cardinality — offline is a 503, signed-out a 401, loading never
//      answers), and every app's Weave declarations at /api/<app>/capabilities|datasets,
//      so a dataset source is discovered and a form finds its command;
//   3. drive headless Chromium over the DevTools Protocol (test/lib/cdp.mjs): open each
//      job in each face, wait for the page's own ready signal, read its report, and
//      optionally capture the contact sheet.
//
// Returns [{ id, mode, report, png? }]; `report.cells[]` carries, per tier × state:
// fault (the error tile rendered), overflowX/overflowY (the card outgrew its
// footprint), and clipped (text cut off without an ellipsis).

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { findChromium, launch } from '../../test/lib/cdp.mjs';
import { REPO_ROOT, appDocs } from './catalog.mjs';

const ORDECK = join(REPO_ROOT, 'apps/ordeck');
/** The zone every preview renders in — Jag's, where the HUD is actually looked at. */
export const PREVIEW_TZ = 'America/Chicago';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

/** Build the preview page into a fresh scratch directory; returns its path. */
export function buildPreview() {
  const out = mkdtempSync(join(tmpdir(), 'jkos-widget-preview-'));
  execFileSync(join(ORDECK, 'node_modules/.bin/vite'), ['build', '--config', 'vite.preview.config.ts', '--outDir', out, '--logLevel', 'error'],
    { cwd: ORDECK, stdio: ['ignore', 'pipe', 'pipe'] });
  return out;
}

/** The empty answer for a widget's source: null for a one-document dataset, else []. */
function emptyAnswer(def, name, docs) {
  const s = def?.spec?.sources?.[name];
  if (s?.kind !== 'dataset') return [];
  const ds = docs[s.app]?.datasets?.datasets?.find((d) => d.id === s.dataset);
  return ds?.cardinality === 'one' ? null : [];
}

function serve(dist, jobs) {
  const docs = appDocs();
  const held = new Set();
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p === '/job.json') {
      const job = jobs[Number(url.searchParams.get('job'))];
      return job ? json(res, 200, job.page) : json(res, 404, { error: 'no such job' });
    }
    const fx = p.match(/^\/__fixture\/(\d+)\/([a-z-]+)\/(.+)$/);
    if (fx) {
      const [, n, state, name] = fx;
      if (state === 'loading') { held.add(res); res.on('close', () => held.delete(res)); return; }   // the state IS no answer
      if (state === 'offline') return json(res, 503, { error: 'unavailable' });
      if (state === 'signed-out') return json(res, 401, { error: 'Not authenticated' });           // no code: authFetch will not try a refresh
      const job = jobs[Number(n)];
      const fixture = job?.fixtures?.[state]?.[name];
      // No fixture: the EMPTY answer for what the source is — [] for a list, null for a
      // one-document dataset (a [] there would be a declared document answering a list).
      return json(res, 200, fixture !== undefined ? fixture : emptyAnswer(job?.page?.def, name, docs));
    }
    const api = p.match(/^\/api\/([a-z]+)\/(capabilities|datasets)$/);
    if (api) {
      const doc = docs[api[1]]?.[api[2]];
      return doc ? json(res, 200, doc) : json(res, 404, { error: 'no such doc' });
    }
    if (p.startsWith('/api/') || p.startsWith('/auth/')) return json(res, 404, { error: 'not served by the preview' });
    const file = normalize(join(dist, p === '/' ? 'index.html' : p));
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { for (const h of held) h.destroy(); server.close(r); }),
  })));
}

/**
 * @param {{ def: object, fixtures?: object }[]} widgets
 * @param {{ modes?: ('paper'|'dark')[], states?: string[], shots?: boolean, scale?: number, accent?: number }} opts
 * @returns {Promise<null | { id: string, mode: string, report: object, png?: Buffer }[]>} null = no browser
 */
export async function renderWidgets(widgets, { modes = ['paper', 'dark'], states, shots = false, scale = 1, accent } = {}) {
  const chromium = findChromium();
  if (!chromium) return null;
  const dist = buildPreview();
  const jobs = [];
  for (const w of widgets) for (const mode of modes) {
    jobs.push({ id: w.def.id, mode, fixtures: w.fixtures ?? {}, page: { def: w.def, mode, states, accent } });
  }
  const srv = await serve(dist, jobs);
  const browser = await launch(chromium);
  const results = [];
  try {
    const page = await browser.page();
    await page.send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1400, deviceScaleFactor: scale, mobile: false });
    // The clock is pinned (preview/sample.ts); pin the zone too, so a local time or an
    // `ago` draws the same text on every machine and the layout ratchet stays still.
    await page.send('Emulation.setTimezoneOverride', { timezoneId: PREVIEW_TZ });
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      await page.goto(`${srv.base}/index.html?job=${i}`);
      await page.waitFor('window.__widgetReady === true', { timeoutMs: 30_000 });
      const report = await page.eval('window.__widgetReport');
      report.pageErrors = page.consoleErrors.splice(0);
      const result = { id: job.id, mode: job.mode, report };
      if (shots && !report.error) {
        // Size the camera to the sheet, so nothing past a fixed viewport is cut off.
        await page.send('Emulation.setDeviceMetricsOverride', { width: report.width, height: report.height, deviceScaleFactor: scale, mobile: false });
        result.png = await page.screenshot({ x: 0, y: 0, width: report.width, height: report.height });
        await page.send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1400, deviceScaleFactor: scale, mobile: false });
      }
      results.push(result);
    }
    await page.close();
  } finally {
    await browser.close();
    await srv.close();
    rmSync(dist, { recursive: true, force: true });
  }
  return results;
}
