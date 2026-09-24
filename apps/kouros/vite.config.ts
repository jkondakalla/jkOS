import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // One backend: the audiobooks are this app's own since PapyrOS folded in
      // (2026-09-23), so the `/api/papyros` peer route this used to need is gone.
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
