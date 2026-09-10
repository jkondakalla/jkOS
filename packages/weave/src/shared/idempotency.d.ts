// Types for the reserved idempotency field (idempotency.js). One name, one reader,
// one declaration helper — see that file's header for why it is not three.

/** The reserved body field every write capability may accept, and that the trigger
 *  engine always sends. */
export const IDEMPOTENCY_FIELD: 'idempotency_key';
/** The longest key a door will honour — it becomes half a primary key. */
export const IDEMPOTENCY_MAX_LEN: number;
/** The key in `body`, or null. Blank, over-long and non-string all read as absent:
 *  no key means no dedup, never an error. */
export function idempotencyKeyOf(body: unknown): string | null;
/** The optional body field a write capability declares. */
export function idempotencyBodyField(): { name: string; type: 'string'; label: string; max: number };
