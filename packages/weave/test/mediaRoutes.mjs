// @jkos/weave mediaRoutes tests — the 4th Layer-D brick (defineMediaRoutes, git history
// Wave 17, 17.3). Two shapes in one file (chained after lego.mjs by `pnpm --filter
// @jkos/weave test`, which the root `test:contracts` gate runs):
//
//   1. a PURE unit test of the playback DECISION ENGINE (decidePlayback) — client
//      capabilities in → { rung: 'direct'|'remux'|'reencode', rendition, reason } out,
//      the Jellyfin direct-play → direct-stream → transcode ladder the whole brick
//      exists to generalize. Driven directly (no ffmpeg, no fs, no server) — it is a
//      pure function, so it is provable in isolation.
//
//   2. a TEXT-SCAN gate over the brick source pinning the invariants each of which was a
//      real papyros production bug: NO `spawnSync` (a sync ffmpeg blocks the event loop),
//      `spawn` called exactly once, the GET stream READ handler NEVER generates
//      (generation is POST …/prepare's job only), atomic `rename` on exit 0, and the
//      freshness rule `exists && size>0 && mtime ≥ source`.
//
// The live wire behaviour (Range 206/416, ?compat single-flight, prepare→poll→ready,
// mtime regeneration, the exact headers) is proven end-to-end by the REAL server smoke
// apps/papyros/backend/test/playback.smoke.mjs, which rides the migrated brick unchanged.
//
// Run: node packages/weave/test/mediaRoutes.mjs

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const SRC = join(HERE, '..', 'src', 'server', 'mediaRoutes.js')
const { defineMediaRoutes, decidePlayback } = require(SRC)

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`) } else { fail++; console.error(`  ✗ ${msg}`) } }
const section = (t) => console.log(`\n${t}`)

/* Remove // and /* *\/ comments so a scan can't be fooled by a comment that MENTIONS the
   forbidden token (the brick's own header says "spawn never spawnSync"). */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/* ═══ 1 · the decision engine (pure) ═══════════════════════════════════════════════ */
section('1 · decidePlayback — client capabilities in → rung out')

// A papyros-flavoured ladder, but the RULES are config (satisfies predicates), never
// brick literals: rung 0 direct → rung 1 faststart-remux → rung 2 universal re-encode.
const remuxArgs = (src, out) => ['-y', '-i', src, '-map', '0:a:0', '-c', 'copy', '-f', 'mp4', out]
const reencodeArgs = (src, out) => ['-y', '-i', src, '-c:a', 'aac', out]
const ladder = [
  { level: 0, strategy: 'direct', satisfies: (_s, c) => !!c.canDirectPlay },
  { level: 1, strategy: 'remux', ext: '.m4a', contentType: 'audio/mp4', satisfies: (_s, c) => !!c.canPlayFaststartMp4, args: remuxArgs },
  { level: 2, strategy: 'reencode', ext: '.m4a', contentType: 'audio/mp4', args: reencodeArgs },   // no satisfies = universal floor
]
const source = { container: 'mp4', codec: 'aac' }

// Chrome-like client can direct-play → rung 0, nothing to generate.
const chrome = decidePlayback({ ladder, source, client: { canDirectPlay: true } })
ok(chrome.rung === 'direct' && chrome.level === 0, 'a direct-play-capable client → rung direct (level 0)')
ok(chrome.rendition === null, 'the direct rung has no rendition (serve the source itself)')

// Firefox-like client can't direct-play the strict m4b but can play a faststart remux → rung 1.
const firefox = decidePlayback({ ladder, source, client: { canDirectPlay: false, canPlayFaststartMp4: true } })
ok(firefox.rung === 'remux' && firefox.level === 1, 'a client that cannot direct-play but can play a remux → rung remux (level 1)')
ok(firefox.rendition === ladder[1], 'the remux decision carries the rung as its rendition (ext/args in hand)')
ok(firefox.rendition.args === remuxArgs && firefox.rendition.ext === '.m4a', 'the rendition exposes the ffmpeg args builder + output ext')

// An ancient client that can consume neither → the universal re-encode floor (rung 2,
// reached because it has no satisfies predicate).
const ancient = decidePlayback({ ladder, source, client: { canDirectPlay: false, canPlayFaststartMp4: false } })
ok(ancient.rung === 'reencode' && ancient.level === 2, 'a client that can consume neither → rung reencode (level 2, the transcode floor)')
ok(ancient.rendition === ladder[2], 'the reencode decision carries the rung 2 rendition')

// Escalation is monotone: each less-capable client lands on a rung >= the previous.
ok(chrome.level <= firefox.level && firefox.level <= ancient.level, 'the ladder escalates monotonically direct → remux → reencode')

// requestedLevel mode (papyros's wire — the player asks for an explicit rung).
const req1 = decidePlayback({ ladder, requestedLevel: 1 })
ok(req1.rung === 'remux' && req1.rendition === ladder[1] && /request/i.test(req1.reason), 'requestedLevel:1 resolves to that rung (reason names the request)')
const req0 = decidePlayback({ ladder, requestedLevel: 0 })
ok(req0.rung === 'direct' && req0.rendition === null, 'requestedLevel:0 → the direct rung (no rendition — not a compat variant)')
const req9 = decidePlayback({ ladder, requestedLevel: 9 })
ok(req9.rung === null && req9.rendition === null, 'an out-of-ladder requestedLevel → { rung:null, rendition:null } (the route 400s)')

// An exhaustive ladder (every rung has a predicate, all false) still resolves — falls
// back to the highest rung rather than returning nothing.
const strictLadder = [
  { level: 0, strategy: 'direct', satisfies: () => false },
  { level: 1, strategy: 'remux', ext: '.m4a', satisfies: () => false, args: remuxArgs },
]
const fell = decidePlayback({ ladder: strictLadder, source, client: {} })
ok(fell.level === 1 && /fallback/i.test(fell.reason), 'a ladder whose every rung refuses still resolves to the highest rung (fallback)')

// Purity: repeated calls with the same inputs give the same result and mutate nothing.
const a = decidePlayback({ ladder, requestedLevel: 1 })
const b = decidePlayback({ ladder, requestedLevel: 1 })
ok(a.rung === b.rung && a.level === b.level && ladder.length === 3, 'decidePlayback is pure — deterministic, no ladder mutation')

/* ═══ 2 · the factory — validation + mount surface (no express, no ffmpeg) ═════════ */
section('2 · defineMediaRoutes — spec validation + mount surface')

let threw
threw = false; try { defineMediaRoutes({}) } catch { threw = true }
ok(threw, 'throws without spec.resolveFile')
threw = false; try { defineMediaRoutes({ resolveFile: () => null }) } catch { threw = true }
ok(threw, 'throws without spec.contentType')
threw = false; try { defineMediaRoutes({ resolveFile: () => null, contentType: () => 'x', ladder }) } catch { threw = true }
ok(threw, 'throws when a ladder is supplied but cacheDir is not (variants would have nowhere to land)')

// A fake router that just records what got wired — proves the URL surface without express.
function fakeRouter() {
  const routes = []
  return { routes, get: (p) => routes.push(['GET', p]), post: (p) => routes.push(['POST', p]) }
}

const full = defineMediaRoutes({
  resolveFile: () => null,
  resolveCover: () => null,
  contentType: () => 'audio/mp4',
  ladder,
  cacheDir: '/tmp/does-not-matter',
})
ok(typeof full.mount === 'function' && typeof full.decide === 'function'
  && typeof full.prepared === 'function' && typeof full.ensurePrepared === 'function',
  'returns { mount, decide, prepared, ensurePrepared }')
ok(full.decide({ requestedLevel: 1 }).rung === 'remux', 'decide() is pre-bound to the spec ladder')

let r = fakeRouter(); full.mount(r)
const wired = r.routes.map((x) => `${x[0]} ${x[1]}`)
ok(wired.includes('GET /api/stream/:id/:fileIndex'), 'mounts GET /api/stream/:id/:fileIndex')
ok(wired.includes('POST /api/stream/:id/:fileIndex/prepare'), 'mounts POST …/prepare when a ladder is present')
ok(wired.includes('GET /api/cover/:id'), 'mounts GET /api/cover/:id when resolveCover is supplied')
ok(wired.includes('GET /api/download/:id'), 'mounts GET /api/download/:id')

// No ladder, no cover → no prepare route, no cover route; custom route bases honoured.
const lean = defineMediaRoutes({ resolveFile: () => null, contentType: () => 'x', routes: { stream: '/api/track', download: '/api/dl' } })
r = fakeRouter(); lean.mount(r)
const leanWired = r.routes.map((x) => `${x[0]} ${x[1]}`)
ok(leanWired.includes('GET /api/track/:id/:fileIndex'), 'stream route base is injectable (/api/track)')
ok(!leanWired.some((x) => x.includes('/prepare')), 'no prepare route without a ladder')
ok(!leanWired.some((x) => x.includes('/api/cover')), 'no cover route without resolveCover')
ok(lean.decide({ requestedLevel: 1 }).rung === null, 'a ladderless instance decides no compat rung')

/* ═══ 3 · text-scan gate — the invariants, each a former production bug ════════════ */
section('3 · invariants pinned by source scan (spawnSync / prepare-only / atomic rename / freshness)')

const raw = readFileSync(SRC, 'utf8')
const src = stripComments(raw)

ok(!/\bspawnSync\b/.test(src), 'no spawnSync anywhere in the brick (a sync ffmpeg starves the event loop)')
ok((src.match(/\bspawn\s*\(/g) || []).length === 1, 'spawn() is called exactly once (one generation code path)')

// prepare-only generation: extract the GET stream READ handler by its markers and assert
// its body reaches NO generation entry point; the POST prepare handler DOES.
const between = (open, close) => {
  const i = raw.indexOf(open); const j = raw.indexOf(close)
  return i >= 0 && j > i ? stripComments(raw.slice(i + open.length, j)) : ''
}
const streamBody = between('/* handler:stream */', '/* end:stream */')
const prepareBody = between('/* handler:prepare */', '/* end:prepare */')
ok(streamBody.length > 0 && prepareBody.length > 0, 'stream + prepare handler markers are present (the gate can locate them)')
ok(!/ensureGeneration|runGeneration|ensurePrepared|\bspawn\s*\(/.test(streamBody),
  'the GET stream READ handler NEVER generates (no ensureGeneration/ensurePrepared/spawn on the read path)')
ok(/ensurePrepared/.test(prepareBody), 'the POST prepare handler IS the generation entry point (calls ensurePrepared)')

ok(/renameSync\s*\(/.test(src) && /\.tmp/.test(src), 'atomic rename via a .tmp sibling')
ok(/code\s*!==\s*0/.test(src), 'rename is gated on ffmpeg exit code 0')
ok(/size\s*>\s*0/.test(src) && /mtimeMs\s*>=/.test(src), 'freshness rule = exists && size>0 && mtime ≥ source')

/* ═══ 4 · ESM twin parity ═════════════════════════════════════════════════════════ */
section('4 · mediaRoutes.mjs re-exports the CJS impl (no drift)')
const mjs = readFileSync(join(HERE, '..', 'src', 'server', 'mediaRoutes.mjs'), 'utf8')
ok(/from '\.\/mediaRoutes\.js'/.test(mjs), 'the .mjs twin re-exports ./mediaRoutes.js (single implementation)')
ok(/export const defineMediaRoutes/.test(mjs) && /export const decidePlayback/.test(mjs),
  'the .mjs twin exports both the factory and the decision engine')

/* ═══ summary ═════════════════════════════════════════════════════════════════════ */
console.log(`\nmediaRoutes: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
