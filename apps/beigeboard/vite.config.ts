import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    commonjsOptions: {
      // The frontend imports CJS single-source modules from the workspace —
      // @jkos/auth-middleware/codes (codes.js) via auth-client, and @jkos/suite-manifest
      // (apps.js) via @jkos/weave. @rollup/plugin-commonjs only transforms node_modules
      // by default, so a workspace CJS file's `module.exports` is invisible to rollup at
      // build time ("CODES is not exported by codes.js"). Extend the transform to those
      // dirs; node_modules MUST stay included or every CJS npm dep breaks.
      include: [/node_modules/, /packages\/auth-middleware\//, /packages\/suite-manifest\//],
    },
  },
})
