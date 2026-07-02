/**
 * workshop/model.ts — the canvas editor's tree model.
 *
 * The old workshop flattened a spec into Row[] and back, which was lossy:
 * nested stack/row nodes dropped out on edit. The canvas editor instead edits
 * the WidgetNode tree itself, wrapped in ENodes — the same node objects the
 * renderer consumes, each tagged with an ephemeral editor id so gestures
 * (tap/drag/menu) can address them. enToNode strips the ids back off, so a
 * published spec is byte-for-byte the same pure-data shape as before.
 *
 * Children live on the ENode (kids for stack/row/form, named slots for
 * list.item / when.then / when.else); the child fields on `node` are stale
 * placeholders that enToNode overwrites on export. All tree ops are immutable
 * (clone-on-path), so undo/redo is snapshot-cheap.
 */

import type { AppId } from '@jkos/weave';
import type { WidgetNode } from '../hud/types';

export type NodeT = WidgetNode['t'];
export type SlotName = 'item' | 'then' | 'else';
const SLOT_NAMES: SlotName[] = ['item', 'then', 'else'];
export const SLOT_LABEL: Record<SlotName, string> = { item: 'EACH ITEM', then: 'THEN', else: 'ELSE' };

let seq = 0;
export const newId = (): string => `e${++seq}x${Math.random().toString(36).slice(2, 6)}`;

export interface ENode {
  id: string;
  /** The node's OWN props. For containers/slot-holders the child fields here are
   *  stale — kids/slots are the truth; enToNode reassembles them on export. */
  node: WidgetNode;
  /** Ordered children (stack / row / form). */
  kids?: ENode[];
  /** Named single-child slots (list.item, when.then, when.else). */
  slots?: Partial<Record<SlotName, ENode>>;
}

export const isKidContainer = (t: NodeT): boolean => t === 'stack' || t === 'row' || t === 'form';

/* ── spec ⇄ editor tree (lossless both ways) ────────────────────────────── */

export function nodeToEn(n: WidgetNode): ENode {
  const en: ENode = { id: newId(), node: n };
  if (n.t === 'stack' || n.t === 'row' || n.t === 'form') en.kids = n.children.map(nodeToEn);
  else if (n.t === 'list') en.slots = { item: nodeToEn(n.item) };
  else if (n.t === 'when') en.slots = { then: nodeToEn(n.then), ...(n.else ? { else: nodeToEn(n.else) } : {}) };
  return en;
}

export function enToNode(en: ENode): WidgetNode {
  const n = en.node;
  if (n.t === 'stack' || n.t === 'row' || n.t === 'form') {
    return { ...n, children: (en.kids ?? []).map(enToNode) };
  }
  if (n.t === 'list') return { ...n, item: en.slots?.item ? enToNode(en.slots.item) : n.item };
  if (n.t === 'when') {
    const out: Extract<WidgetNode, { t: 'when' }> = { ...n, then: en.slots?.then ? enToNode(en.slots.then) : n.then };
    if (en.slots?.else) out.else = enToNode(en.slots.else);
    else delete out.else;
    return out;
  }
  return n;
}

export const emptyStack = (): ENode => ({ id: newId(), node: { t: 'stack', gap: 8, children: [] }, kids: [] });

/* ── lookup ─────────────────────────────────────────────────────────────── */

export function findEn(root: ENode, id: string): ENode | null {
  if (root.id === id) return root;
  for (const k of root.kids ?? []) { const r = findEn(k, id); if (r) return r; }
  for (const s of SLOT_NAMES) { const c = root.slots?.[s]; if (c) { const r = findEn(c, id); if (r) return r; } }
  return null;
}

export interface Place {
  parent: ENode;
  key: { kind: 'kid'; index: number } | { kind: 'slot'; name: SlotName };
}

/** Where `id` sits (null for the root itself / not found). */
export function findPlace(root: ENode, id: string): Place | null {
  const kids = root.kids ?? [];
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].id === id) return { parent: root, key: { kind: 'kid', index: i } };
    const r = findPlace(kids[i], id);
    if (r) return r;
  }
  for (const s of SLOT_NAMES) {
    const c = root.slots?.[s];
    if (!c) continue;
    if (c.id === id) return { parent: root, key: { kind: 'slot', name: s } };
    const r = findPlace(c, id);
    if (r) return r;
  }
  return null;
}

/** Root-to-node ancestor chain (inclusive), or null when absent. */
export function pathTo(root: ENode, id: string): ENode[] | null {
  if (root.id === id) return [root];
  for (const k of root.kids ?? []) { const r = pathTo(k, id); if (r) return [root, ...r]; }
  for (const s of SLOT_NAMES) { const c = root.slots?.[s]; if (c) { const r = pathTo(c, id); if (r) return [root, ...r]; } }
  return null;
}

/** Is `id` within (or equal to) the subtree rooted at `ancestorId`? */
export function isInside(root: ENode, ancestorId: string, id: string): boolean {
  const sub = findEn(root, ancestorId);
  return !!sub && !!findEn(sub, id);
}

export function hasFormAncestor(root: ENode, id: string): boolean {
  const path = pathTo(root, id);
  return !!path && path.slice(0, -1).some((en) => en.node.t === 'form');
}

/* ── immutable rebuild ──────────────────────────────────────────────────── */

/** Rebuild the tree with `id`'s subtree passed through fn; fn returning null
 *  removes it (a removed REQUIRED slot — list.item / when.then — is replaced
 *  with an empty stack so the node stays renderable). Untouched branches keep
 *  their references. The root itself is never removed. */
export function rewrite(root: ENode, id: string, fn: (en: ENode) => ENode | null): ENode {
  const step = (en: ENode): ENode | null => {
    if (en.id === id) return fn(en);
    let changed = false;
    let kids = en.kids;
    if (kids) {
      const next: ENode[] = [];
      let kidChanged = false;
      for (const k of kids) {
        const r = step(k);
        if (r !== k) kidChanged = true;
        if (r) next.push(r);
      }
      if (kidChanged) { kids = next; changed = true; }
    }
    let slots = en.slots;
    if (slots) {
      for (const name of SLOT_NAMES) {
        const c = slots[name];
        if (!c) continue;
        const r = step(c);
        if (r === c) continue;
        slots = { ...slots };
        if (r) slots[name] = r;
        else if (name === 'else') delete slots[name];
        else slots[name] = emptyStack();
        changed = true;
      }
    }
    return changed ? { ...en, kids, slots } : en;
  };
  const out = step(root);
  return out ?? root;
}

/* ── tree operations ────────────────────────────────────────────────────── */

/** Shallow-merge props onto a node. Loosely typed on purpose: callers patch one
 *  variant's fields (the inspector knows which), and spreading the 24-variant
 *  union cross-product would melt tsc. Setting a key to undefined drops it. */
export function patchEn(root: ENode, id: string, patch: Record<string, unknown>): ENode {
  return rewrite(root, id, (en) => {
    const node = { ...(en.node as unknown as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete node[k];
      else node[k] = v;
    }
    return { ...en, node: node as unknown as WidgetNode };
  });
}

export function insertKid(root: ENode, parentId: string, index: number, child: ENode): ENode {
  return rewrite(root, parentId, (en) => {
    const kids = [...(en.kids ?? [])];
    kids.splice(Math.max(0, Math.min(index, kids.length)), 0, child);
    return { ...en, kids };
  });
}

export function removeEn(root: ENode, id: string): ENode {
  return rewrite(root, id, () => null);
}

export function setSlot(root: ENode, parentId: string, name: SlotName, child: ENode | undefined): ENode {
  return rewrite(root, parentId, (en) => {
    const slots = { ...(en.slots ?? {}) };
    if (child) slots[name] = child;
    else delete slots[name];
    return { ...en, slots };
  });
}

export function moveEn(root: ENode, id: string, parentId: string, index: number): ENode {
  if (id === root.id) return root;
  if (id === parentId || isInside(root, id, parentId)) return root;   // never into own subtree
  const en = findEn(root, id);
  const place = findPlace(root, id);
  if (!en || !place) return root;
  let idx = index;
  if (place.parent.id === parentId && place.key.kind === 'kid' && place.key.index < index) idx -= 1;
  return insertKid(removeEn(root, id), parentId, idx, en);
}

/** Deep copy with fresh ids (for duplicate / paste-like ops). */
export function reIdentify(en: ENode): ENode {
  const copy: ENode = { id: newId(), node: en.node };
  if (en.kids) copy.kids = en.kids.map(reIdentify);
  if (en.slots) {
    copy.slots = {};
    for (const s of SLOT_NAMES) if (en.slots[s]) copy.slots[s] = reIdentify(en.slots[s]!);
  }
  return copy;
}

export function duplicateEn(root: ENode, id: string): { root: ENode; newId: string | null } {
  const en = findEn(root, id);
  const place = findPlace(root, id);
  if (!en || !place || place.key.kind !== 'kid') return { root, newId: null };
  const copy = reIdentify(en);
  return { root: insertKid(root, place.parent.id, place.key.index + 1, copy), newId: copy.id };
}

/** Wrap a node in a new container (row / stack / when-condition). */
export function wrapEn(root: ENode, id: string, kind: 'row' | 'stack' | 'when'): { root: ENode; newId: string | null } {
  if (id === root.id) return { root, newId: null };
  let wrapperId: string | null = null;
  const next = rewrite(root, id, (en) => {
    const wrapper: ENode =
      kind === 'when'
        ? { id: newId(), node: { t: 'when', cond: { src: 'today', path: 'showTasks' }, then: en.node }, slots: { then: en } }
        : { id: newId(), node: { t: kind, gap: 8, children: [] }, kids: [en] };
    wrapperId = wrapper.id;
    return wrapper;
  });
  return { root: next, newId: wrapperId };
}

/* ── compatibility (what the context menu offers where) ─────────────────── */

/** Can a `t` node be inserted as a child of `parent`? Controls only make sense
 *  inside a form's $form scope; forms don't nest; molecules are self-contained
 *  cards so they only sit directly on the root stack. */
export function canInsert(root: ENode, parent: ENode, t: NodeT): boolean {
  if (!isKidContainer(parent.node.t)) return false;
  const inForm = parent.node.t === 'form' || hasFormAncestor(root, parent.id);
  if (t === 'form') return !inForm;
  if (t === 'input' || t === 'select' || t === 'toggle') return inForm;
  if (t === 'calendar' || t === 'weather') return parent.id === root.id;
  return true;
}

export function allowedTypes(root: ENode, parent: ENode): NodeT[] {
  return CATALOG.filter((c) => canInsert(root, parent, c.t)).map((c) => c.t);
}

/* ── catalog + factory defaults ─────────────────────────────────────────── */

export interface CatalogEntry { t: NodeT; label: string; hint: string }

export const CATALOG: CatalogEntry[] = [
  { t: 'metric', label: 'Metric', hint: 'big number + unit' },
  { t: 'gauge', label: 'Gauge', hint: 'circular % ring' },
  { t: 'bar', label: 'Progress bar', hint: 'value vs max' },
  { t: 'keyval', label: 'Key / value', hint: 'name left, value right' },
  { t: 'list', label: 'List', hint: 'repeat a template over an array' },
  { t: 'pill', label: 'Status pill', hint: 'small coloured badge' },
  { t: 'dot', label: 'Status dot', hint: 'coloured indicator' },
  { t: 'text', label: 'Text', hint: 'heading or body line' },
  { t: 'label', label: 'Eyebrow label', hint: 'small uppercase caption' },
  { t: 'icon', label: 'Icon', hint: 'a line glyph (sun, check, book…)' },
  { t: 'divider', label: 'Divider', hint: 'rule, optional caption' },
  { t: 'link', label: 'Link button', hint: 'opens a URL' },
  { t: 'time', label: 'Big clock', hint: 'large time + meta lines' },
  { t: 'row', label: 'Row', hint: 'lay children side by side' },
  { t: 'stack', label: 'Stack', hint: 'group children vertically' },
  { t: 'when', label: 'Condition', hint: 'show a branch only when true' },
  { t: 'calendar', label: 'Calendar', hint: 'month grid (cal slice)' },
  { t: 'weather', label: 'Weather', hint: 'full weather card' },
  { t: 'form', label: 'Action form', hint: 'inputs that submit a command' },
  { t: 'button', label: 'Action button', hint: 'one tap runs a command' },
  { t: 'input', label: 'Form input', hint: 'text/number/date field' },
  { t: 'select', label: 'Form select', hint: 'pick from options' },
  { t: 'toggle', label: 'Form toggle', hint: 'on/off checkbox' },
];

export const catalogEntry = (t: NodeT): CatalogEntry =>
  CATALOG.find((c) => c.t === t) ?? { t, label: t, hint: '' };

/** A CommandRef must carry an AppId; a freshly-dropped form/button hasn't picked
 *  one yet. The empty id renders soft-disabled (fetchCapabilities('') → null),
 *  and the inspector is where the real app gets chosen. */
const NO_APP = '' as AppId;

export function newNode(t: NodeT): ENode {
  const leaf = (node: WidgetNode): ENode => ({ id: newId(), node });
  switch (t) {
    case 'label': return leaf({ t, text: 'LABEL', size: 'md' });
    case 'text': return leaf({ t, text: 'Heading', variant: 'title' });
    case 'metric': return leaf({ t, value: { src: 'systems', path: 'up' }, unit: '' });
    case 'bar': return leaf({ t, value: { src: 'systems', path: 'up' }, max: { src: 'systems', path: 'total' } });
    case 'gauge': return leaf({ t, value: { src: 'systems', path: 'up' }, max: { src: 'systems', path: 'total' } });
    case 'pill': return leaf({ t, text: 'OK', tone: 'ok' });
    case 'dot': return leaf({ t, tone: 'ok' });
    case 'keyval': return leaf({ t, label: 'Name', value: 'Value', tone: 'muted' });
    case 'divider': return leaf({ t });
    case 'link': return leaf({ t, text: 'Open', href: 'https://' });
    case 'icon': return leaf({ t, name: 'sun', tone: 'accent' });
    case 'time': return leaf({ t, value: { src: 'clock', path: 'hm' }, seconds: { src: 'clock', path: 'ss' }, sub: { src: 'clock', path: 'dateLine' }, sub2: { src: 'clock', path: 'utcLine' } });
    case 'calendar': return leaf({ t });
    case 'weather': return leaf({ t });
    case 'list': {
      const item: WidgetNode = { t: 'keyval', label: { src: '$', path: 'name' }, value: { src: '$', path: 'detail' } };
      return { id: newId(), node: { t, from: { src: 'systems', path: 'rows' }, empty: 'NOTHING', item }, slots: { item: nodeToEn(item) } };
    }
    case 'stack': return { id: newId(), node: { t, gap: 8, children: [] }, kids: [] };
    case 'row': return { id: newId(), node: { t, gap: 8, children: [] }, kids: [] };
    case 'when': {
      const then = emptyStack();
      return { id: newId(), node: { t, cond: { src: 'today', path: 'showTasks' }, then: then.node }, slots: { then } };
    }
    case 'form': return { id: newId(), node: { t, cmd: { app: NO_APP, capability: '' }, submit: 'SUBMIT', children: [] }, kids: [] };
    case 'button': return leaf({ t, text: 'GO', cmd: { app: NO_APP, capability: '' } });
    case 'input': return leaf({ t, field: 'value', placeholder: 'Value…' });
    case 'select': return leaf({ t, field: 'choice', options: { lit: ['A', 'B'] }, placeholder: 'Pick…' });
    case 'toggle': return leaf({ t, field: 'flag', label: 'Flag' });
  }
}

/* ── display helpers ────────────────────────────────────────────────────── */

/** Short human label for a binding, for canvas chips ("systems.rows", "OK"…). */
export function bindingLabel(b: unknown): string {
  if (b == null) return '';
  if (typeof b !== 'object') return String(b);
  const o = b as { lit?: unknown; src?: string; path?: string };
  if ('lit' in o) return o.lit == null ? '' : String(o.lit);
  if (o.src) return o.path ? `${o.src}.${o.path}` : o.src;
  return '';
}
