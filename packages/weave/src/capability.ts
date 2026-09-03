/**
 * weave/capability.ts — the capability contract.
 *
 * An app declares what can be DONE to it by serving a CapabilityDoc at its
 * `capabilitiesPath` (GET /api/<app>/capabilities). This is the write-side mirror
 * of jkAuth's read-side `app_registry`: app-owned data, served by the app about
 * itself. jkAuth stores only WHERE to find it (capabilities_path), never the
 * capabilities themselves — so adding an app's write surface needs no central
 * edit, and the blast radius of a malformed capability stays inside that app.
 *
 * These are pure data shapes. How a widget BINDS form fields to a capability's
 * body (CommandRef + Bindings) lives in the widget engine; the dispatcher here
 * takes an already-resolved plain body.
 */

export type FieldType =
  | 'string'   // single-line text
  | 'text'     // multi-line text
  | 'number'
  | 'boolean'
  | 'date'     // YYYY-MM-DD
  | 'time'     // HH:MM (24h)
  | 'enum'     // one of `enum`
  | 'json'     // a structured DOCUMENT (nested tree / arbitrary object), not a flat
               // form field. ⚠️ Not automatically an escape hatch — see `schema`
               // below. A `json` field with no `schema` is an opaque blob a GUI/AI
               // cannot snap a stud onto, and the capability-completeness probe
               // flags it; one WITH a schema is an honest description of something
               // that genuinely is a document, and is not a gap.
  | 'ref';     // a reference to another primitive's row — a typed STUD. The target
               // collection is named by `ref` ('<app>.<dataset>'), so a GUI/AI knows
               // this field IS "a task" / "an event" / "a device", not just a string.

/** One field in a capability's request body, or one column of a returned row. The
 *  server still validates; this drives the GUI mapper and client-side required/shape
 *  hints, plus AI composition (a self-describing stud). */
export interface BodyField {
  name: string;          // wire key, e.g. 'title'
  type: FieldType;
  label?: string;        // human label for the workshop mapper
  required?: boolean;
  enum?: string[];       // when type === 'enum'
  ref?: string;          // when type === 'ref': the referenced dataset, '<app>.<dataset>'
                         // (e.g. 'beigeboard.items') — the typed stud another lego snaps onto
  default?: unknown;     // literal default if the form omits it
  max?: number;          // length cap (string/text)

  /**
   * ⭐ FOR `type: 'json'` ONLY — what this document IS, and where its shape is
   * written down (D3's remainder).
   *
   * ⚠️ THE DECISION THIS FIELD RECORDS. Seven capabilities were flagged for "using
   * the json escape hatch", and treating that as one defect was wrong: the flagged
   * fields are two different things.
   *
   *   A LIST OF KNOWN ROWS — `blocked_by` is item rows, `candidate` is a
   *     metadataSearch row, `warnings` is a fixed {path,code,message} shape. These
   *     WERE a defect: the shape was known and simply not declared, so a GUI had to
   *     be told it out of band.
   *
   *   A RECURSIVE DOCUMENT — a routine `spec` is forty steps with phases, variants
   *     and progression rules; an import `items` is an arbitrarily nested tree.
   *     Flattening either into a `BodyField[]` is not possible, and pretending
   *     otherwise would produce a declaration that lies. Here the hatch is an HONEST
   *     DESCRIPTION, and the real defect was that nothing said so or said where the
   *     shape lives.
   *
   * So: name the schema. Either form is checkable, and `capability-completeness`
   * requires one:
   *
   *   '<app>.<dataset>'          the document is that dataset's row shape (or an
   *                              array/tree of it) — the probe asserts the dataset
   *                              actually exists in that app's declaration
   *   'Documentation/FILE.md'    the shape is prose, in a file the probe asserts
   *                              exists
   */
  schema?: string;
}

/** One action an app can perform on behalf of the caller. */
export interface CapabilityDef {
  id: string;                       // stable within the app, e.g. 'createItem'
  label: string;                    // 'Add a task'
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;                     // RELATIVE to the app's apiBase: '/items' or '/items/:id'
  body?: BodyField[];               // omit for DELETE
  returns?: BodyField[];            // the shape THE CALL ANSWERS WITH — the immediate HTTP
                                    // response. For a synchronous capability this is also the
                                    // result, and it is the primitive's OUTPUT stud (mirror of
                                    // DatasetDef.item), so a GUI/AI can wire one lego's result
                                    // into the next's input. Omit only for a pure side-effect
                                    // (e.g. DELETE) whose body echo is the request.

  /**
   * ⭐ ASYNC ONLY (WV-5). What the WORK eventually produces, as distinct from what the
   * CALL answers with.
   *
   * ⚠️ THE BUG THIS EXISTS TO CLOSE. Every LazurOS capability declares
   * `returns: [{ name:'job_id', type:'string' }]`. That is CORRECT for the HTTP response
   * — you get a job handle — and useless for composition, because a binding engine
   * reading `returns` sees a `string` where the real result lives, and will cheerfully
   * type-check a job UUID into a task title. It would not error. It would create a task
   * called `a3f1c8e2-…`, and the only symptom is a nonsense row.
   *
   * ⚠️ THE PRESENCE OF THIS FIELD IS THE DECLARATION THAT THE CAPABILITY IS ASYNC.
   * There is deliberately no separate `async: true` — two fields that must agree are two
   * fields that can disagree, and this suite has paid for that shape before.
   *
   * A binder must therefore use `resolves` when it is present and NEVER `returns`, and
   * the trigger that consumes an async capability fires on the job's COMPLETION, not on
   * the call. See server/trigger.js's validateTriggerTypes, and `pnpm check:async` which
   * fails any capability that returns a bare handle without saying what it resolves to.
   */
  resolves?: BodyField[];
  /**
   * ⭐ THE RESERVED IDEMPOTENCY FIELD (RESET A2c.4). A write capability accepts an
   * optional `idempotency_key` in its body, and the trigger engine ALWAYS sends one.
   *
   * ⚠️ Why it matters here specifically: a trigger's DO is a write fired by an event,
   * and both halves of that sentence can repeat — a webhook redelivers, a dispatch
   * times out and is retried, a peer replays. Without a key the second attempt is a
   * second task on someone's board and the user cannot tell which is real.
   *
   * The engine's key is DERIVED, never random: same trigger + same event ⇒ same key,
   * which is the only property that makes a retry recognisable AS one. A random key
   * makes every attempt look new, which is worse than no key because it looks solved.
   *
   * ⚠️ NO RECEIVER HONOURS IT YET. This constant has no importer, no app declares the
   * field, and nothing stores seen keys — so a retried DO still double-writes and the
   * key is dropped as an unknown body key. Sending a key is the half that is done;
   * dedup at the write door is the half that is owed. Do not read the presence of this
   * field as protection.
   */
  invalidates?: string[];           // resource keys to refetch after success: ['beigeboard.items']
  roles?: string[];                 // coarse gate (defaults to the app's allowed_roles)
  scopes?: string[];                // fine gate, enforced by the resource app
  ai?: boolean;
  doc?: string;                     // long-form description (a non-flat body or AI hint) — markdown ok
}

/** The reserved body field every write capability may accept, and that the trigger
 *  engine always sends. Named once so no app spells it differently. */
export const IDEMPOTENCY_FIELD = 'idempotency_key';

/** What an app returns from its capabilitiesPath. */
export interface CapabilityDoc {
  app: string;                      // must match the manifest id
  version: number;                  // bump on breaking body changes
  capabilities: CapabilityDef[];
}
