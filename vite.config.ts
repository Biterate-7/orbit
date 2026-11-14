import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the same dist/ works on the web host and inside the packaged
  // Windows app (Electron serves it from app://lost-orbit/, see electron/main.cjs).
  base: './',
  server: { port: 5173, host: true },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // The bundled astronomical catalogue is data, not code: keep it in its own cacheable file.
        manualChunks(id) {
          if (id.includes('/astronomy/data/')) return 'catalogue';
          return undefined;
        },
      },
    },
  },
});
