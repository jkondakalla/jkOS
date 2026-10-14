/**
 * hud/catalog.ts — every widget the suite ships, compiled into ORDECK from files.
 *
 * A widget is a file: `apps/<app>/widgets/<id>.json` (its preview fixtures beside it as
 * `<id>.fixtures.json`). ORDECK's own cards live in apps/ordeck/widgets/ like any app's —
 * they used to be a TypeScript literal in state.ts, which no agent could add to without
 * editing ORDECK, and which the gate, the CLI and the preview each had to transpile to
 * read. Now an app adds a card by adding a file, and every tool reads the same files.
 *
 * Vite resolves the glob at BUILD time (the images build from the repo root, so every
 * app's widgets/ is in the context). The gate holds this list to the files on disk
 * (check:widget-render reads the preview build's CATALOG), and every file to both
 * validation tiers (check:widgets).
 */

import type { WidgetDef as AnyWidgetDef } from '@jkos/widget-render';
import type { WidgetDef } from './types';

const files = import.meta.glob<AnyWidgetDef>(
  ['../../../*/widgets/*.json', '!../../../*/widgets/*.fixtures.json'],
  { eager: true, import: 'default' },
);

/** The files that are HUD cards: placed by a footprint. A widget with no `sizing` is a
 *  screen or a part, drawn by its own app — never on the HUD's shelf. */
const placeable = Object.entries(files).filter((e): e is [string, WidgetDef] => e[1].sizing != null);

/** id → def, for every HUD card of every app. */
export const CATALOG: Readonly<Record<string, WidgetDef>> = Object.freeze(
  Object.fromEntries(placeable.map(([, def]) => [def.id, def])),
);

/** Which app ships each catalog widget (its file's folder). */
export const CATALOG_APP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(placeable.map(([path, def]) => [def.id, path.split('/').at(-3) ?? ''])),
);

/** Each widget's preview fixtures (`<id>.fixtures.json`), loaded only when asked for —
 *  the Workshop's gallery draws every widget in every state from them, as the preview
 *  harness does; the HUD itself never loads them. */
const fixtureFiles = import.meta.glob<Record<string, Record<string, unknown>>>(
  '../../../*/widgets/*.fixtures.json',
  { import: 'default' },
);
export async function loadFixtures(): Promise<Record<string, Record<string, Record<string, unknown>>>> {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  await Promise.all(Object.entries(fixtureFiles).map(async ([path, load]) => {
    out[path.split('/').pop()!.replace(/\.fixtures\.json$/, '')] = await load();
  }));
  return out;
}
