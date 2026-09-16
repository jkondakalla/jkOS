// Types for the reserved idempotency field (idempotency.js). One name, one reader,
// one declaration helper — see that file's header for why it is not three.

/** The reserved body field every write capability may accept, and that the trigger
 *  engine always sends. */
export const IDEMPOTENCY_FIELD: 'idempotency_key';
/** The longest key a door will honour — it becomes half a primary key. */
export const IDEMPOTENCY_MAX_LEN: number;
/** The key in `body`, or null. Absent or blank means no dedup, never an error.
 *  Over-long and non-string also read as null here — a door refuses those first,
 *  via `idempotencyKeyError`. */
export function idempotencyKeyOf(body: unknown): string | null;
/** Why a PRESENT key cannot be honoured (non-string, over the declared max), or null.
 *  A door answers 400 VALIDATION rather than writing without dedup. */
export function idempotencyKeyError(body: unknown): string | null;
/** The optional body field a write capability declares. */
export function idempotencyBodyField(): { name: string; type: 'string'; label: string; max: number };
