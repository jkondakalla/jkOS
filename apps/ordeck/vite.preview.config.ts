import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

// The widget preview harness (preview/) — built by `pnpm widget shot` and
// `pnpm check:widget-render` into a scratch directory, never by ORDECK's own build,
// so the page is not shipped. Same plugins and CommonJS handling as the app.
export default mergeConfig(base, defineConfig({
  root: 'preview',
  base: './',
  build: { emptyOutDir: true, minify: false, sourcemap: false },
}));
