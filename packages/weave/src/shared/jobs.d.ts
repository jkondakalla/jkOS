// Types for jobs.js — the common declared shape of asynchronous work.

export const JOB_HANDLE: 'job_id';
export const JOB_DONE: 'DONE';
export const JOB_FAILED: 'FAILED';
export const JOB_FIELDS: readonly { name: string; type: string }[];

export type JobPhase = 'done' | 'failed' | 'pending';

/** Where a job row stands. */
export function jobPhase(row: { status?: unknown } | null | undefined): JobPhase;

/** Problems with a dataset declaring `shape: 'jobs'`; [] when it is one. */
export function checkJobsDataset(def: {
  id: string; shape?: string; cardinality?: string;
  item?: { name: string; type: string; enum?: string[] }[];
  filters?: { name: string; op?: string; column?: string }[];
}): string[];
