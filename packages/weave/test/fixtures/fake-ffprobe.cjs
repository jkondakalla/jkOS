#!/usr/bin/env node
'use strict';
// fake-ffprobe.cjs — test double for the real `ffprobe` binary, used ONLY by
// packages/weave/test/libraryScanner.mjs to drive defineLibraryScanner's actual ladder
// (walk/pool/sort/aggregate/upsert/prune/single-flight) hermetically — no real ffprobe
// process, no real audio decoding, no network.
//
// Real ffprobe's last CLI arg is the target file path. This stub just echoes THAT
// FILE'S OWN CONTENTS to stdout — so a "fixture audio file" in the test is literally a
// small hand-authored ffprobe-JSON text file, and the brick's real (unmodified)
// probeFile()/parseProbe() parse it exactly as they would genuine ffprobe output.
const fs = require('node:fs');

const filePath = process.argv[process.argv.length - 1];
try {
  process.stdout.write(fs.readFileSync(filePath));
  process.exitCode = 0;
} catch (err) {
  process.stderr.write(String((err && err.message) || err));
  process.exitCode = 1;
}
