import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // ⚠️ ORDER MATTERS — vite matches proxy keys in insertion order and '/api'
      // is a prefix of '/api/papyros', so the peer must come FIRST or every
      // audiobook request is quietly served by the music backend (which answers
      // 404, and looks exactly like "PapyrOS is down").
      //
      // This mirrors what nginx does in production: `weave-proxy.conf` answers
      // /api/papyros/* on this origin and rewrites the prefix away before
      // proxying, which is what lets a KourOS page stream a PapyrOS book
      // same-origin with the jkos_token cookie. Without the same rewrite here,
      // the seam works deployed and 404s on a developer's machine.
      '/api/papyros': {
        target: 'http://localhost:3010',
        rewrite: (p) => p.replace(/^\/api\/papyros/, '/api'),
      },
      '/api': 'http://localhost:3011',
    },
  },
  build: {
    outDir: 'dist',
    commonjsOptions: {
      // The frontend imports CJS single-source workspace modules — @jkos/auth-middleware/
      // codes via auth-client, @jkos/suite-manifest via @jkos/weave. @rollup/plugin-commonjs
      // only transforms node_modules by default, so a workspace CJS file's module.exports is
      // invisible to rollup at build time; extend the transform to those dirs.
      include: [/node_modules/, /packages\/auth-middleware\//, /packages\/suite-manifest\//],
    },
  },
})
