/**
 * weave/followJob.ts — follow an async command to what it produced.
 *
 * An async capability answers a handle (`{ job_id }`) and declares what its work
 * `resolves` to. Its app declares one dataset in the common jobs shape
 * (shared/jobs.js): look the job up by `job_id`, and it ends DONE (its `result` holds
 * the resolved fields) or FAILED (its `error` says why). So following ANY app's async
 * command is the same few lines, and they are these — a widget's form, another app's
 * frontend, an agent's harness. No per-app code, and no reading LazurOS's source to
 * learn where a result lands.
 *
 * Re-reads when the jobs dataset's bus keys fire, and on a backing-off interval (the
 * worker that finishes a job is not in this browser, so nothing here invalidates on
 * its completion). Gives up after `timeoutMs` as `lost` — the job may still finish;
 * this caller has stopped waiting, and says so rather than spinning for ever.
 */

import { fetchDatasets } from './fetchDatasets';
import { readDataset } from './readDataset';
import { subscribe } from './resource';
import type { AppId } from './manifest';
import { JOB_HANDLE, jobPhase } from './shared/jobs.js';

export interface JobOutcome {
  /** done / failed are the job's own ends; lost = no longer followed (timeout, no
   *  jobs dataset, the job vanished); pending only in an onUpdate while it runs. */
  phase: 'pending' | 'done' | 'failed' | 'lost';
  /** The app's own status word (LazurOS: PENDING, PENDING_WAKEUP, IN_PROGRESS…). */
  status?: string;
  /** Once done: exactly the fields the capability's `resolves` declares. */
  result?: unknown;
  error?: string;
}

export interface FollowOptions {
  /** Called with every reading, including the pending ones (a status to show). */
  onUpdate?: (o: JobOutcome) => void;
  /** Aborting stops the follow; the promise resolves `lost`. */
  signal?: AbortSignal;
  /** First re-read after this many ms, doubling to `maxIntervalMs` (defaults 1500 / 15000). */
  intervalMs?: number;
  maxIntervalMs?: number;
  /** Stop waiting after this long (default 10 minutes). */
  timeoutMs?: number;
}

export async function followJob(appId: AppId, jobId: string, opts: FollowOptions = {}): Promise<JobOutcome> {
  const { onUpdate, signal, intervalMs = 1500, maxIntervalMs = 15000, timeoutMs = 10 * 60_000 } = opts;
  const doc = await fetchDatasets(appId);
  const jobs = doc?.datasets.find((d) => d.shape === 'jobs');
  if (!jobs) return { phase: 'lost', error: `${appId} declares no jobs dataset to follow the job in` };

  const until = Date.now() + timeoutMs;
  let wait = intervalMs;
  let wake: (() => void) | null = null;
  const unsub = subscribe(jobs.invalidates ?? [], () => wake?.());
  const onAbort = () => wake?.();
  signal?.addEventListener('abort', onAbort);
  try {
    for (;;) {
      if (signal?.aborted) return { phase: 'lost', error: 'stopped following' };
      const r = await readDataset(appId, jobs.id, { [JOB_HANDLE]: jobId });
      if (r.state === 'ready' || r.state === 'empty') {
        const row = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]).find((j) => String(j.id) === String(jobId)) : undefined;
        if (!row) return { phase: 'lost', error: `${appId} has no job ${jobId}` };
        const phase = jobPhase(row);
        const o: JobOutcome = {
          phase,
          status: typeof row.status === 'string' ? row.status : undefined,
          ...(phase === 'done' ? { result: row.result } : {}),
          ...(phase === 'failed' ? { error: typeof row.error === 'string' ? row.error : 'failed' } : {}),
        };
        onUpdate?.(o);
        if (phase !== 'pending') return o;
      } else if (r.state === 'signed-out' || r.state === 'forbidden' || r.state === 'unavailable') {
        return { phase: 'lost', error: r.error ?? r.state };
      }
      // pending, or a transient offline: wait for the bus, the interval or the deadline.
      if (Date.now() >= until) return { phase: 'lost', error: 'still running — stopped waiting' };
      await new Promise<void>((res) => {
        const t = setTimeout(() => { wake = null; res(); }, Math.min(wait, Math.max(0, until - Date.now())));
        wake = () => { clearTimeout(t); wake = null; res(); };
      });
      wait = Math.min(wait * 2, maxIntervalMs);
    }
  } finally {
    unsub();
    signal?.removeEventListener('abort', onAbort);
  }
}
