// scaffold.mjs — `pnpm widget new`: a first draft of a widget, derived from what its app declares.
//
// A widget binds fields an app DECLARES (its DatasetDoc / CapabilityDoc), so a draft can
// be read off the declaration instead of typed from memory: the source, a pattern that
// fits the dataset's cardinality, bindings to real field names, and fixtures that are the
// declared row with sample values. The draft passes both validation tiers and draws in
// every state before it is written — what is left is judgement: which fields matter,
// what the empty line says, how big the card is. Then `pnpm widget shot`, and LOOK.

import { cardinalityOf, checkDatasetAnswer } from '../../packages/weave/src/shared/datasetShape.js';

/** The patterns a draft can start from, by what the dataset answers. */
export const DRAFT_PATTERNS = { many: ['rows', 'feed'], one: ['facts', 'stat', 'meter', 'media'] };

const TITLE_NAMES = ['title', 'name', 'label', 'text', 'summary', 'capability'];
const isText = (f) => f.type === 'string' || f.type === 'text';
const isInstant = (f) => /(_at|At)$/.test(f.name);
const isUrl = (f) => /(^|_)(url|href|image)$/i.test(f.name);
/** A number that is a fraction of 1 — word-bounded, so `duration` is not a ratio. */
const FRACTION = /(^|_)(progress|fraction|ratio|pct)($|_)/;
const words = (name) => name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** The fields a draft binds, read off the declared item: a title, a second line, a
 *  time, a number, an art URL. Any of them may be missing. */
function roles(item) {
  const scalar = item.filter((f) => f.type !== 'json');
  const title = TITLE_NAMES.map((n) => scalar.find((f) => f.name === n && isText(f))).find(Boolean)
    ?? scalar.find((f) => isText(f) && !isUrl(f) && !isInstant(f) && f.name !== 'id');
  const sub = scalar.find((f) => f !== title && isText(f) && !isUrl(f) && !isInstant(f) && f.name !== 'id');
  const at = scalar.find(isInstant) ?? scalar.find((f) => f.type === 'date');
  const number = scalar.find((f) => f.type === 'number' && f.name !== 'id' && !/_id$/.test(f.name));
  const progress = scalar.find((f) => f.type === 'number' && FRACTION.test(f.name));
  const image = scalar.find(isUrl);
  return { scalar, title, sub, at, number, progress, image };
}

/* ── Sample values: what the preview draws, shaped exactly as declared ─────────────── */

// The preview's pinned instant (apps/ordeck/src/hud/pinned.ts): Mon 28 Sep 2026, 09:41:27 Chicago.
const PINNED_MS = Date.UTC(2026, 8, 28, 14, 41, 27);

function sample(field, i) {
  const n = field.name;
  switch (field.type) {
    case 'string':
    case 'text':
      if (isInstant(field)) return new Date(PINNED_MS - (i + 1) * 37 * 60_000).toISOString();
      if (isUrl(field)) return null; // an invented URL would draw a broken image
      return `${words(n)} ${i + 1}`;
    case 'number':
      if (FRACTION.test(n)) return [0.42, 0.8, 0.15][i % 3];
      return n === 'id' || /_id$/.test(n) ? i + 1 : (i + 1) * 7;
    case 'boolean': return i % 2 === 0;
    case 'date': return new Date(PINNED_MS - i * 86_400_000).toISOString().slice(0, 10);
    case 'time': return ['09:30', '13:00', '17:45'][i % 3];
    case 'enum': return Array.isArray(field.enum) && field.enum.length ? field.enum[i % field.enum.length] : null;
    case 'ref': return i + 1;
    case 'json':
      // Present but empty: a draft binds no nested document (a --from list is filled in
      // by the caller), and `item` alone does not say whether this is one or a list.
      return field.of ? [] : null;
    default: return null;
  }
}
const sampleDoc = (item, i) => Object.fromEntries(item.map((f) => [f.name, sample(f, i)]));

/* ── Bodies ─────────────────────────────────────────────────────────────────────────── */

const bind = (src, path, extra) => (path ? { src, path, ...extra } : { src, ...extra });

function listBody(pattern, src, r, path) {
  const row = (f, extra) => (f ? bind('$', f.name, extra) : undefined);
  const when = r.at ? row(r.at, r.at.type === 'date' ? { fmt: 'date' } : undefined) : undefined;
  if (pattern === 'feed') {
    return { t: 'feed', from: bind(src, path), text: row(r.title), detail: row(r.sub), at: r.at && isInstant(r.at) ? row(r.at) : undefined, max: 8 };
  }
  return {
    t: 'rows', from: bind(src, path), title: row(r.title), sub: row(r.sub),
    detail: when && r.at.type !== 'date' ? row(r.at, { fmt: 'ago' }) : when,
    max: 8,
  };
}

function docBody(pattern, src, r) {
  const at = (f, extra) => bind(src, f.name, extra);
  if (pattern === 'stat') return { t: 'stat', label: words(r.number.name).toUpperCase(), value: at(r.number, { fmt: 'number' }), sub: r.title ? at(r.title) : undefined };
  if (pattern === 'meter') return { t: 'meter', label: words(r.progress.name), value: at(r.progress), detail: at(r.progress, { fmt: 'percent' }) };
  if (pattern === 'media') {
    return { t: 'media', image: r.image ? at(r.image) : undefined, title: at(r.title), subtitle: r.sub ? at(r.sub) : undefined, progress: r.progress ? at(r.progress) : undefined };
  }
  const shown = r.scalar.filter((f) => f.name !== 'id' && !isUrl(f)).slice(0, 4);
  return {
    t: 'facts', cols: 2,
    items: shown.map((f) => ({ label: words(f.name), value: at(f, isInstant(f) ? { fmt: 'ago' } : f.type === 'number' ? { fmt: 'number' } : undefined) })),
  };
}

/** Drop undefined props so the draft reads like a hand-written file. */
const tidy = (o) => JSON.parse(JSON.stringify(o));

/**
 * Draft a widget over one dataset, or an `ask` over one capability.
 *
 * @param {{ app: string, id: string, dataset?: string, from?: string, ask?: string, pattern?: string,
 *           params?: Record<string, string|number>,
 *           docs: Record<string, { capabilities: any, datasets: any }> }} o
 * @returns {{ def: object, fixtures: object|null, notes: string[] } | { error: string }}
 */
export function draftWidget({ app, id, dataset, from, ask, pattern, params, docs }) {
  const decl = docs[app];
  if (!decl) return { error: `'${app}' declares nothing a widget can bind — apps with declarations: ${Object.keys(docs).join(', ')}` };
  // The house frame: the eyebrow names what the card IS, the source line where it comes from.
  const source = app.toUpperCase();
  const notes = [];

  if (ask) {
    const cap = decl.capabilities?.capabilities?.find((c) => c.id === ask);
    if (!cap) return { error: `${app} declares no capability '${ask}' — it has: ${(decl.capabilities?.capabilities ?? []).map((c) => c.id).join(', ')}` };
    const fields = cap.body ?? [];
    const text = ['text', 'query', 'question', 'prompt'].map((n) => fields.find((f) => f.name === n && isText(f))).find(Boolean)
      ?? fields.find((f) => f.required && isText(f)) ?? fields.find(isText);
    if (!text) return { error: `${app}.${ask} takes no text field for the question — an ask pattern sends one` };
    const others = fields.filter((f) => f.required && f !== text).map((f) => f.name);
    if (others.length) return { error: `an ask sends one field (${text.name}), and ${app}.${ask} also requires ${others.join(', ')} — build it as a form (WIDGETS.md § Commands)` };
    const answer = (cap.resolves ?? cap.returns ?? []).find(isText);
    if (!answer) notes.push(`${app}.${ask} declares no text field in what it answers — set \`answer\` to the $result field to draw`);
    else if (answer.name !== 'response') notes.push(`the answer drawn is $result.${answer.name}`);
    const body = { t: 'ask', cmd: { app, capability: ask }, field: text.name === 'text' ? undefined : text.name, placeholder: `${cap.label ?? 'Ask'}…`, answer: answer && answer.name !== 'response' ? { src: '$result', path: answer.name } : undefined };
    return {
      def: tidy({ id, label: cap.label ?? words(ask), sizing: { desktop: { w: 4, h: 5 }, mobile: { w: 2, h: 5 }, min: { w: 3, h: 4 } }, spec: { frame: { eyebrow: 'ASK', source }, body } }),
      fixtures: null,
      notes,
    };
  }

  const def = decl.datasets?.datasets?.find((d) => d.id === dataset);
  if (!def) return { error: `${app} declares no dataset '${dataset}' — it has: ${(decl.datasets?.datasets ?? []).map((d) => d.id).join(', ')}` };
  if (!Array.isArray(def.item)) return { error: `${app}.${dataset} declares no \`item\` — a widget cannot know its fields. Declare them first (it is a Weave defect).` };
  const card = cardinalityOf(def);
  /* A list draft reads rows: the dataset's own ('many'), or a list inside its one
     document that declares its rows (`--from recent` over kouros.discoverHome). */
  const listFields = def.item.filter((f) => f.type === 'json' && Array.isArray(f.item)).map((f) => f.name);
  let rows = card === 'many' ? def.item : null;
  if (from) {
    if (card === 'many') return { error: `${app}.${dataset} is already a list of rows — --from reads a list inside one document` };
    const f = def.item.find((x) => x.name === from);
    if (!f || f.type !== 'json' || !Array.isArray(f.item)) return { error: `--from names a json field of ${app}.${dataset} that declares its rows' \`item\` — ${listFields.length ? `one of: ${listFields.join(', ')}` : 'it has none'}` };
    rows = f.item;
  }
  const shape = rows ? 'many' : 'one';
  const choice = pattern ?? DRAFT_PATTERNS[shape][0];
  if (!DRAFT_PATTERNS[shape].includes(choice)) {
    return { error: `${app}.${dataset}${from ? `.${from}` : ''} is ${shape === 'many' ? 'a list of rows' : 'one document'}; draft it as one of: ${DRAFT_PATTERNS[shape].join(', ')}` };
  }
  const r = roles(rows ?? def.item);
  const src = /^[A-Za-z_][A-Za-z0-9_]*$/.test(dataset) ? dataset : 'data';
  const orFrom = listFields.length ? ` — or draft a list over ${listFields.length > 1 ? 'one of its lists' : 'its list'}: --from ${listFields.join('|')}` : '';
  if (shape === 'many' && !r.title) return { error: `${app}.${dataset}${from ? `.${from}` : ''}'s rows have no text field to title a row with — draft it by hand` };
  if (choice === 'facts' && !r.scalar.some((f) => f.name !== 'id' && !isUrl(f))) return { error: `${app}.${dataset}'s fields are all documents or lists, nothing for a fact${orFrom}` };
  if (choice === 'stat' && !r.number) return { error: `${app}.${dataset} declares no number for a stat${orFrom}` };
  if (choice === 'meter' && !r.progress) return { error: `${app}.${dataset} declares no progress/fraction/ratio number for a meter${orFrom}` };
  if (choice === 'media' && !r.title) return { error: `${app}.${dataset} declares no text field to title the media with${orFrom}` };

  const needed = [...[...def.path.matchAll(/:(\w+)/g)].map((m) => m[1]), ...(def.filters ?? []).filter((f) => f.required).map((f) => f.name)];
  const missing = needed.filter((k) => !(k in (params ?? {})));
  if (missing.length) return { error: `${app}.${dataset} is read with ${missing.join(', ')} — pass --params ${missing.map((k) => `${k}=…`).join(',')}` };
  const nested = def.item.filter((f) => f.type === 'json' && Array.isArray(f.item) && f.name !== from);
  if (shape === 'one' && nested.length) notes.push(`${nested.map((f) => f.name).join(', ')} ${nested.length > 1 ? 'are documents' : 'is a document'} of ${nested.length > 1 ? 'their' : 'its'} own — bind into ${nested.length > 1 ? 'them' : 'it'} with a dotted path (\`${nested[0].name}.${nested[0].item[0]?.name}\`)`);
  const opaque = def.item.filter((f) => f.type === 'json' && !f.of && !f.item);
  if (!from && opaque.length) notes.push(`${opaque.map((f) => f.name).join(', ')}: declared json with no \`of\`/\`item\`, so nothing checks a binding into ${opaque.length > 1 ? 'them' : 'it'}`);

  const body = shape === 'many' ? listBody(choice, src, r, from) : docBody(choice, src, r);
  const empty = shape === 'many' ? `No ${words(from ?? dataset).toLowerCase()} yet.` : undefined;
  // A list read from inside one document says its own empty line: the document is not
  // empty when the list is, so the frame's would never show (semantic.js `silent-empty`).
  if (from) body.empty = empty;
  // Sizes a first draft fits at (min included — `pnpm widget shot` draws it); a
  // grid of facts needs its rows, a single stat or meter fits a small tile.
  const size = shape === 'many' ? { desktop: { w: 4, h: 5 }, mobile: { w: 2, h: 5 }, min: { w: 3, h: 3 } }
    : choice === 'stat' || choice === 'meter' ? { desktop: { w: 3, h: 3 }, mobile: { w: 2, h: 3 }, min: { w: 2, h: 2 } }
    : { desktop: { w: 3, h: 3 }, mobile: { w: 2, h: 3 }, min: { w: 3, h: 3 } };
  const draft = tidy({
    id, label: words(from ?? dataset), sizing: size,
    spec: {
      frame: { eyebrow: words(from ?? dataset).toUpperCase(), source, empty: from ? undefined : empty },
      sources: { [src]: { kind: 'dataset', app, dataset, params: params && Object.keys(params).length ? params : undefined, poll: 60 } },
      body,
    },
  });

  const sampleRows = rows && [0, 1, 2].map((i) => sampleDoc(rows, i));
  const ready = card === 'many' ? sampleRows : from ? { ...sampleDoc(def.item, 0), [from]: sampleRows } : sampleDoc(def.item, 0);
  const problems = checkDatasetAnswer(def, ready);
  if (problems.length) return { error: `the drafted fixtures do not fit ${app}.${dataset} — a scaffolder bug:\n  ${problems.join('\n  ')}` };
  notes.push(`${id}.fixtures.json holds sample rows shaped as ${app}.${dataset} declares — replace the values with realistic ones (the gate holds them to the declaration)`);
  return { def: draft, fixtures: { ready: { [src]: ready } }, notes };
}
