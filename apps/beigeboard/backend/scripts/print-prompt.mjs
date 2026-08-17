#!/usr/bin/env node
// print-prompt.mjs — write the generic authoring prompt to stdout.
//
// The prompt lives in src/routine-prompt.js, generated from the same constants the
// validator enforces. GET /api/routines/prompt serves it personalised with the
// caller's library; this prints the generic copy, which is what is checked in at
// Documentation/ROUTINE_PROMPT.md so a fresh agent working in the repo can read it
// without a running server.
//
// Regenerate after ANY change to the vocabulary or the prompt:
//
//   node apps/beigeboard/backend/scripts/print-prompt.mjs > Documentation/ROUTINE_PROMPT.md
//
// `pnpm check:routine` fails if the checked-in file has drifted from this output.
//
// Deliberately NOT seeded with a library index: the starter set is per-user data
// that lives behind ./db, and requiring it here would open a database to print a
// document. The generic copy tells the reader where to fetch an index instead.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { buildPrompt } = require(resolve(here, '../src/routine-prompt.js'));

process.stdout.write(buildPrompt({}));
