// Mirror the canonical design-factory tokens into jkAuth's static dir.
//
// jkAuth is a server-rendered Express app with NO bundler, so it can't `import
// '@jkos/design/tokens.css'` the way the Vite apps do — the browser fetches CSS
// over HTTP from express.static('public'). This copies the single source of truth
// (packages/design/tokens/hub.css) into public/jkos-tokens.css, which style.css
// then @imports. Run it whenever the factory tokens change:
//
//   pnpm --filter @jkos/jkauth sync:tokens
//
// The generated file is committed so production (which doesn't run this) ships it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../packages/design/tokens/hub.css');
const out = resolve(here, '../public/jkos-tokens.css');

const banner =
  '/* GENERATED — mirror of @jkos/design/tokens/hub.css. DO NOT EDIT.\n' +
  '   Regenerate: pnpm --filter @jkos/jkauth sync:tokens */\n\n';

writeFileSync(out, banner + readFileSync(src, 'utf8'));
console.log(`synced design tokens → ${out}`);
