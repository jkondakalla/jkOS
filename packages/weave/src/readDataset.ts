/**
 * weave/readDataset.ts — read a declared dataset, and SAY what happened.
 *
 * `weaveClient(app).list()` answered `[]` for every miss: the peer down, a 401, a
 * dataset the peer does not declare, an answer in a shape its declaration does not
 * describe. "The peer is down" and "you have no tasks" were the same value, which is
 * the failure WEAVE.md §3.4 rules out — failing soft is right, failing soft INVISIBLY
 * is not. A widget drawing that `[]` shows "nothing here" to a signed-out user and to a
 * user whose app is offline alike.
 *
 * So this is the one read: discover the dataset (fetchDatasets), fill its path
 * parameters and filters, fetch it edge-proxied (authFetch, so an expired access token
 * is refreshed), and answer a STATE with the data:
 *
 *   ready        rows (cardinality 'many') or the document ('one')
 *   empty        a list with no rows, or a document that is null
 *   idle         a path parameter or a required filter has no value yet — nothing was asked
 *   signed-out   401
 *   forbidden    403
 *   offline      the app, or its declaration, could not be reached
 *   unavailable  the app declares no such dataset, or answered something its
 *                declaration does not describe (a list declared, an object answered)
 *
 * `weaveClient.list` is built on it, so there is one read path to keep right.
 */

import { authFetch } from '@jkos/auth-client';
import { apiBase, suiteApp, type AppId } from './manifest';
import { fetchDatasets, getDataset } from './fetchDatasets';
import type { DatasetDef } from './dataset';
import { cardinalityOf } from './shared/datasetShape.js';

export type ReadState = 'ready' | 'empty' | 'idle' | 'signed-out' | 'forbidden' | 'offline' | 'unavailable';

export interface DatasetRead {
  state: ReadState;
  /** Rows ('many'), the document ('one'), [] / null when empty; undefined on a failure. */
  data?: unknown;
  /** Why, for any state but ready/empty — a person can read it, an agent can act on it. */
  error?: string;
  /** The dataset the read resolved to, when discovery found it. */
  def?: DatasetDef;
}

export type ReadParams = Record<string, string | number | boolean | null | undefined>;

/** `/routines/:id` + { id: 7, weeks: 4 } → `/routines/7?weeks=4`. null when a `:param`,
 *  or a filter the dataset declares `required`, has no value. Only DECLARED filters go on the query string: an undeclared one is
 *  ignored by the server anyway (filters.js), and sending it hides a typo. */
export function datasetUrl(def: DatasetDef, params: ReadParams = {}): string | null {
  const used = new Set<string>();
  let missing = false;
  const path = def.path.replace(/:(\w+)/g, (_, k: string) => {
    used.add(k);
    const v = params[k];
    if (v == null || v === '') { missing = true; return `:${k}`; }
    return encodeURIComponent(String(v));
  });
  if (missing) return null;
  // A REQUIRED filter with no value is as unknown as a missing path parameter: the server
  // would refuse the read (400), so nothing is asked — a pin not dropped yet is not an error.
  if ((def.filters ?? []).some((f) => f.required && !used.has(f.name) && (params[f.name] == null || params[f.name] === ''))) return null;
  const declared = new Set((def.filters ?? []).map((f) => f.name));
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (used.has(k) || !declared.has(k) || v == null || v === '') continue;
    q.set(k, String(v));
  }
  const qs = q.toString();
  return `${path}${qs ? `?${qs}` : ''}`;
}

/** Read one declared dataset and report its state. Never throws. `opts.fetch` replaces
 *  the request itself (a preview answering from fixtures); discovery, the URL and the
 *  shape checks stay the real ones. */
export async function readDataset(
  appId: AppId, datasetId: string, params: ReadParams = {},
  opts: { fetch?: (url: string) => Promise<Response> } = {},
): Promise<DatasetRead> {
  const app = suiteApp(appId);
  if (!app?.datasetsPath) return { state: 'unavailable', error: `${appId} declares no datasets` };
  const doc = await fetchDatasets(appId);
  if (!doc) return { state: 'offline', error: `could not read ${appId}'s declarations` };
  const def = getDataset(doc, datasetId) ?? undefined;
  if (!def) return { state: 'unavailable', error: `${appId} declares no dataset '${datasetId}'` };
  const rel = datasetUrl(def, params);
  if (rel == null) return { state: 'idle', def };

  let res: Response;
  try {
    res = await (opts.fetch ?? authFetch)(`${apiBase(appId)}${rel}`);
  } catch {
    return { state: 'offline', def, error: `${appId} did not answer` };
  }
  if (res.status === 401) return { state: 'signed-out', def, error: 'not signed in' };
  if (res.status === 403) return { state: 'forbidden', def, error: `not allowed to read ${appId}.${datasetId}` };
  if (!res.ok) return { state: 'offline', def, error: `${appId} answered ${res.status}` };

  let body: unknown;
  try { body = await res.json(); } catch {
    return { state: 'unavailable', def, error: `${appId}.${datasetId} did not answer JSON` };
  }
  if (cardinalityOf(def) === 'many') {
    if (!Array.isArray(body)) {
      return { state: 'unavailable', def, error: `${appId}.${datasetId} is declared a list and answered ${body === null ? 'null' : typeof body}` };
    }
    return { state: body.length ? 'ready' : 'empty', data: body, def };
  }
  if (body === null) return { state: 'empty', data: null, def };
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { state: 'unavailable', def, error: `${appId}.${datasetId} is declared one document and answered ${Array.isArray(body) ? 'a list' : typeof body}` };
  }
  return { state: 'ready', data: body, def };
}
