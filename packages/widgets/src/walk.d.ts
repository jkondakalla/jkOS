/** Visit every node in a body, depth-first, parents first. `path` is a JSON Pointer below the body. */
export function walkNodes(node: unknown, visit: (node: { t: string } & Record<string, unknown>, path: string) => void, path?: string): void;

/** Every data source a value depends on (`{src}` bindings + molecule reads).
 *  `commands: false` (the default) skips `cmd` subtrees — they resolve at submit time. */
export function sourcesOf(value: unknown, opts?: { commands?: boolean }): Set<string>;

/** Every action in a node's `on`, flattened, with the event that fires it. */
export function actionsOf(node: unknown): { event: string; action: Record<string, unknown> }[];

/** Every app a widget reaches: each dataset source's app, and every command's. What
 *  "AI-backed" is derived from. */
export function appsOf(def: unknown, widgets?: Readonly<Record<string, unknown>>): Set<string>;

/** What a widget needs from the host that draws it, derived from what it binds. */
export function needsOf(def: unknown, widgets?: Readonly<Record<string, unknown>>): { slices: Set<string>; kinds: Set<string>; actions: Set<string>; navigates: boolean };
/** Does it need nothing of its host — can any host draw it? */
export function isPortable(def: unknown, widgets?: Readonly<Record<string, unknown>>): boolean;
/** What `host` lacks to draw it ([] when it can): 'slice x', 'kind x', 'action x', 'navigation'. */
export function drawableIn(def: unknown, host: { slices?: readonly string[]; kinds?: readonly string[]; actions?: readonly string[]; navigate?: boolean }, widgets?: Readonly<Record<string, unknown>>): string[];

/** A spec's bodies: `body`, and `mobile` when it has one. */
export function bodiesOf(spec: unknown): unknown[];

/** The ids of the parts a widget draws (`use`), directly. */
export function partsOf(def: unknown): Set<string>;
