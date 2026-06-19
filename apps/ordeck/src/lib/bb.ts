/**
 * lib/bb.ts — ORDECK's thin WRITE client for BeigeBoard.
 *
 * Reads live in pages/hud/useHudData (the `today`/`cal` slices). Writes — the
 * quick-add, focus, and pin interop features — funnel through here so there is
 * ONE place that knows BeigeBoard's item shape and the edge-proxied path
 * (`/api/bb/*`, cookies flow, same jkos_token SSO as everything else).
 *
 * BeigeBoard remains the single owner of task data; ORDECK never stores items.
 * Each writer invalidates the 'bb.items' resource on success so useBbItems
 * refetches and the HUD reflects the change immediately instead of waiting for
 * the next poll.
 */

import { invalidate, apiBase } from '@jkos/weave';

const BB = apiBase('beigeboard');

/** Tell the shared BeigeBoard source to refetch right after a write. */
function notifyChanged() {
  invalidate('bb.items');
}

export interface NewItem {
  title: string;
  due_date?: string;     // YYYY-MM-DD
  scheduled_time?: string;
  kind?: string;         // defaults to 'task'
  scope?: string;        // defaults to 'day'
}

/** Create a task/event in BeigeBoard. Returns true on success. */
export async function bbCreateItem(input: NewItem): Promise<boolean> {
  try {
    const r = await fetch(`${BB}/items`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'task', scope: 'day', source: 'bb', ...input }),
    });
    if (r.ok) notifyChanged();
    return r.ok;
  } catch {
    return false;
  }
}

/** Today's date as YYYY-MM-DD in local time (matches how the day slices key). */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
