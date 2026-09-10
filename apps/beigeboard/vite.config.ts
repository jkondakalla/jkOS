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
      // @jkos/auth-middleware/codes (codes.js) via auth-client, @jkos/suite-manifest
      // (apps.js) via @jkos/weave, and @jkos/routine-spec (index.js) via the forge.
      // @rollup/plugin-commonjs only transforms node_modules by default, so a workspace
      // CJS file's `module.exports` is invisible to rollup at build time ("CODES is not
      // exported by codes.js"). Extend the transform to those dirs; node_modules MUST
      // stay included or every CJS npm dep breaks.
      //
      // ⚠️ routine-spec was MISSING from this list and the production build was dead:
      //     packages/routine-spec/src/index.mjs (6:7): "default" is not exported by
      //     packages/routine-spec/src/index.js
      // Its ESM twin does `import mod from './index.js'` against the CJS original, and
      // without the transform rollup cannot synthesize that default. `pnpm test:contracts`
      // never runs `build`, so the gate stayed green while the app could not be built at
      // all — see TESTING.md, "What the gate does not cover".
      // EVERY workspace package this app imports that ships CJS belongs here.
      include: [
        /node_modules/,
        /packages\/auth-middleware\//,
        /packages\/suite-manifest\//,
        /packages\/routine-spec\//,
      ],
    },
  },
})
