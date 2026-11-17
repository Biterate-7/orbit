import { defineConfig } from 'vite';
import type { Connect, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import astroProxy from './api/astro.js';

/**
 * Mounts the astronomical import proxy (api/astro.js) on the dev and preview servers, at the same
 * path the serverless function has on the web host - so live imports work the same everywhere.
 */
function astroProxyPlugin(): Plugin {
  const mount = (middlewares: Connect.Server): void => {
    middlewares.use('/api/astro', (req, res) => {
      // connect strips the mount path; the handler only reads the query string.
      void astroProxy(req, res);
    });
  };
  return {
    name: 'lost-orbit-astro-proxy',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  };
}

export default defineConfig({
  plugins: [react(), astroProxyPlugin()],
  // Relative asset URLs so the same dist/ works on the web host and inside the packaged
  // Windows app (Electron serves it from app://lost-orbit/, see electron/main.cjs).
  base: './',
  server: { port: 5173, host: true },
  build: {
    target: 'es2020',
    // The catalogue chunk is bundled astronomical data (~1.1 MB, ~215 kB gzipped), not code.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // The bundled astronomical data is data, not code: keep it in its own cacheable file.
        manualChunks(id) {
          if (id.includes('/astronomy/data/')) return 'catalogue';
          return undefined;
        },
      },
    },
  },
});
