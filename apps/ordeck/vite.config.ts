import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

// In development:  plugins served on localhost:300x
// In production:   plugins served via nginx at https://YOUR_DOMAIN/plugins/xxx/
//
// Set VITE_PLUGIN_BASE_URL in the shell's .env.production, e.g.:
//   VITE_PLUGIN_BASE_URL=https://YOUR_DOMAIN/plugins

const DEV_PORTS: Record<string, number> = {
  'plex-plugin':            3001,
  'lazuros-plugin':         3002,
  'beigeboard-plugin':      3003,
  'recipe-plugin':          3004,
  'sylibos-plugin':         3005,
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_PLUGIN_BASE_URL?.replace(/\/$/, '');

  const remotes = Object.fromEntries(
    Object.entries(DEV_PORTS).map(([name, port]) => {
      // strip trailing '-plugin' for the nginx path segment
      const slug = name.replace(/-plugin$/, '');
      const url  = base
        ? `${base}/${slug}/assets/remoteEntry.js`
        : `http://localhost:${port}/assets/remoteEntry.js`;
      return [name, url];
    })
  );

  return {
    plugins: [
      react(),
      federation({
        name: 'shell',
        remotes,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shared: {
          react: { singleton: true, requiredVersion: '^18' },
          'react-dom': { singleton: true, requiredVersion: '^18' },
        } as any,
      }),
    ],
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
        // Dev proxy: routes data APIs → their respective services
        // LazurOS and BeigeBoard need prefix stripping — their routes don't
        // include the /api/lazuros/ or /api/beigeboard/ prefix internally.
        '/api/lazuros': {
          target:      'http://localhost:8080',
          changeOrigin: true,
          rewrite:     (path: string) => path.replace(/^\/api\/lazuros/, ''),
        },
        '/api/beigeboard': {
          target:      'http://localhost:3001',
          changeOrigin: true,
          rewrite:     (path: string) => path.replace(/^\/api\/beigeboard/, ''),
        },
        '/api/plex':            { target: 'http://localhost:8001', changeOrigin: true },
        '/api/recipes':         { target: 'http://localhost:8002', changeOrigin: true },
        '/api/sylibos':  { target: 'http://localhost:8004', changeOrigin: true,
                           rewrite: (path: string) => path.replace(/^\/api\/sylibos/, '') },
      },
    },
    build: {
      target:       'esnext',
      minify:       'esbuild',   // host shell — minify the production bundle
      cssCodeSplit: false,
    },
  };
});
