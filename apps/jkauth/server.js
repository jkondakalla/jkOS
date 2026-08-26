'use strict'
// jkOS Auth (SSO) — entry point. The service is split into src/ modules:
//   config  env constants            db      sqlite + migrations + seeds
//   util    escaping/redirect/pw     tokens  JWT + session cookies
//   views   server-rendered HTML     app     express factory (middleware+routes)
//   routes/ auth · profile · twofactor · weave
// Requiring ./src/app opens the DB and runs migrations/seeds (once), exactly as
// the previous single-file server did at startup.

const app = require('./src/app')
const { PORT } = require('./src/config')

app.listen(PORT, () => console.log(`[jkos-auth] listening on :${PORT}`))
