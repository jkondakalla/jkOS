// Types for semantic.js — the second validation tier: a widget's bindings, sources and
// commands against the declarations they name.

export interface Declarations {
  /** Each app's CapabilityDoc / DatasetDoc, as served (or required from discovery.js). */
  docs?: Record<string, { capabilities?: { capabilities: object[] } | null; datasets?: { datasets: object[] } | null }>;
  /** The host's slice declaration (ORDECK: apps/ordeck/src/hud/slices.ts HUD_SLICES). */
  slices?: Record<string, object>;
  /** The host's action declaration (ORDECK: HUD_ACTIONS): name → { args?, returns? }. */
  actions?: Record<string, { label?: string; args?: { name: string; type: string; required?: boolean }[]; returns?: { name: string; type: string }[] }>;
}

/** Problems (JSON Pointer + code + message + fix?) — [] when every binding reaches a declaration. */
export function checkBindings(def: unknown, ctx?: Declarations): { path: string; code: string; message: string; fix?: string }[];
