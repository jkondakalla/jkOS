'use strict';
// Centralised configuration — every env-derived constant lives here so the rest
// of the backend reads from one place (mirrors jkAuth's src/config.js). Values are
// resolved once at require time. Pure data, zero side effects.
const path = require('path');
const { resolveIssuer } = require('@jkos/auth-middleware');   // shared issuer default (single source)

const PORT       = process.env.PORT       || 3001;
const DB_PATH    = process.env.DB_PATH    || path.join(__dirname, '..', 'beigeBoard.db');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', '..', 'dist');
const SHELL_URL  = (process.env.SHELL_URL || 'http://localhost:3000').replace(/\/$/, '');

/* Cross-origin allowlist. The suite directory (jkAuth app_registry) is the
   canonical list of app origins; ops mirrors it here via ALLOWED_ORIGINS (comma-
   separated) so a second suite app can call BeigeBoard cross-origin. SHELL_URL is
   always included for backward compatibility. */
const ALLOWED_ORIGINS = new Set(
  [SHELL_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')]
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
);

/* RSA public key from jkos-auth — used by the weaveAuth middleware. Prefer
   JWKS-by-kid (key rotation, U3) when JKOS_AUTH_JWKS_URI is set; else verify
   against the static public key. */
const JKOS_AUTH_PUBLIC_KEY = (process.env.JKOS_AUTH_PUBLIC_KEY || '').trim();
const JKOS_AUTH_ISSUER     = resolveIssuer();   // shared default ('jkos-auth'), JKOS_AUTH_ISSUER overrides
const JKOS_AUTH_JWKS_URI   = (process.env.JKOS_AUTH_JWKS_URI  || '').trim();
const CALENDAR_ENC_KEY     = (process.env.CALENDAR_ENC_KEY    || '').trim();  // 64 hex chars → AES-256 at rest
const IS_PROD              = process.env.NODE_ENV === 'production';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI
  || `http://localhost:${PORT}/api/auth/google/callback`;

const MS_CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MS_REDIRECT_URI  = process.env.MICROSOFT_REDIRECT_URI
  || `http://localhost:${PORT}/api/auth/outlook/callback`;
const MS_AUTH_URL  = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_GRAPH     = 'https://graph.microsoft.com/v1.0';

const ICLOUD_CALDAV = 'https://caldav.icloud.com';

module.exports = {
  PORT, DB_PATH, STATIC_DIR, SHELL_URL, ALLOWED_ORIGINS,
  JKOS_AUTH_PUBLIC_KEY, JKOS_AUTH_ISSUER, JKOS_AUTH_JWKS_URI, CALENDAR_ENC_KEY, IS_PROD,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
  MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI, MS_AUTH_URL, MS_TOKEN_URL, MS_GRAPH,
  ICLOUD_CALDAV,
};
