import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ORDECK is the HUD shell. It used to load per-app widgets as Module-Federation
// remotes; v3 replaced those with native, data-driven widgets from the registry
// (src/hud/), so the federation plugin + remote wiring were removed.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Dev proxy: routes /auth/* → jkos-auth (port 3100) so httpOnly cookies
      // land on localhost:3000 (same origin as the shell).
      // Set VITE_JKOS_AUTH_URL=http://localhost:3000 in .env.local so the
      // frontend sends auth calls through this proxy during development.
      '/auth': {
        target:              'http://localhost:3100',
        changeOrigin:        true,
        cookieDomainRewrite: 'localhost',
      },
      // Dev proxy: routes data APIs → their respective services.
      // BeigeBoard needs prefix stripping (its routes are /api/items, not
      // /api/beigeboard/items). LazurOS does NOT: the State node registers its routes
      // at their full edge paths (/api/lazuros/health, /api/lazuros/<capability>), so
      // the prefix must survive — mirroring the nginx block, which also preserves it.
      '/api/lazuros': {
        target:      'http://localhost:8080',
        changeOrigin: true,
      },
      '/api/beigeboard': {
        target:      'http://localhost:3001',
        changeOrigin: true,
        rewrite:     (path: string) => path.replace(/^\/api\/beigeboard/, ''),
      },
      '/api/sylibos':  { target: 'http://localhost:8004', changeOrigin: true,
                         rewrite: (path: string) => path.replace(/^\/api\/sylibos/, '') },
    },
  },
  build: {
    target:       'esnext',
    minify:       'esbuild',   // host shell — minify the production bundle
    cssCodeSplit: false,
    commonjsOptions: {
      // The frontend imports two CJS single-source modules from the workspace —
      // @jkos/auth-middleware/codes (codes.js) and @jkos/suite-manifest (apps.js).
      // @rollup/plugin-commonjs only transforms node_modules by default, so a
      // workspace CJS file's `module.exports` is invisible to rollup at build time
      // ("CODES is not exported by codes.js"). Extend the transform to those dirs;
      // node_modules MUST stay included or every CJS npm dep breaks.
      include: [/node_modules/, /packages\/auth-middleware\//, /packages\/suite-manifest\//],
    },
  },
});
