/**
 * fixtures.ts — how a widget's sources are read for one preview STATE.
 *
 * Shared by every contact sheet (each app's preview entry, through ./preview/kit) and
 * ORDECK's Workshop gallery, so all of them draw a state the same way. The REAL reader's
 * steps stay: a dataset is discovered through its app's declaration and its answer held
 * to it (readDataset), a suite URL in a fetch source is refused (readExternal). Only the
 * request itself is answered: from the widget's fixtures (`<id>.fixtures.json`: state →
 * source → answer), else the empty answer for what the source is ([] for a list, null for
 * one document); offline is a 503, signed-out a 401, loading never answers.
 */

import { readDataset, fetchDatasets, getDataset } from '@jkos/weave';
import { readExternal, type SourceReader } from './sources';

export type PreviewState = 'ready' | 'empty' | 'offline' | 'signed-out' | 'loading';
export const PREVIEW_STATES: PreviewState[] = ['ready', 'empty', 'offline', 'signed-out', 'loading'];

export function fixtureReader(state: PreviewState, fixtures: Record<string, Record<string, unknown>> | null | undefined): SourceReader {
  return async (name, source, params) => {
    const answer = async (): Promise<Response> => {
      if (state === 'loading') return new Promise<Response>(() => {});
      if (state === 'offline') return new Response('{"error":"unavailable"}', { status: 503 });
      if (state === 'signed-out') return new Response('{"error":"Not authenticated"}', { status: 401 });
      let body = fixtures?.[state]?.[name];
      if (body === undefined) {
        const one = source.kind === 'dataset'
          && getDataset(await fetchDatasets(source.app), source.dataset)?.cardinality === 'one';
        body = one ? null : [];
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    if (source.kind === 'dataset') {
      const r = await readDataset(source.app, source.dataset, params, { fetch: answer });
      return { ...r, invalidates: r.def?.invalidates };
    }
    if (source.kind === 'fetch') return readExternal(source.url, answer);
    return { state: 'unavailable', error: 'unknown source kind' };
  };
}
