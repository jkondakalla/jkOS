import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'beigeboard-plugin',
      filename: 'remoteEntry.js',
      exposes: { './Widget': './src/Widget' },
      shared: {
        react: { singleton: true, requiredVersion: '^18' },
        'react-dom': { singleton: true, requiredVersion: '^18' },
      },
    }),
  ],
  resolve: {
    alias: {
      '@jkos/beigeboard': '../../apps/beigeboard/src',
      '@jkos/ui': '../../packages/ui/src',
      '@jkos/types': '../../packages/types/src/index.ts',
    },
  },
  server: { port: 3003 },
  build: { target: 'esnext', minify: false, cssCodeSplit: false },
});
