'use strict';
// BeigeBoard backend — entry point. The server is split into src/ modules
// (mirroring jkAuth's src/ layout):
//   config   env constants          db        sqlite + migrations (run on require)
//   crypto   secret-at-rest + CSRF   util      safeJson/date/fail/toRow
//   schema   item column + import validation   auth   identity gate + PUBLIC_PATHS
//   items-store  parent/cascade/seed  calendar/*  provider sync (google/outlook/icloud)
//   routes/  items · import · ai · calendar       app   express factory (middleware+mounts)
// Requiring ./src/app transitively opens the DB and runs migrations (once), exactly
// as the previous single-file server did in boot() before listen.
const app = require('./src/app');
const { PORT } = require('./src/config');

app.listen(PORT, () => console.log(`BeigeBoard running on :${PORT}`));
