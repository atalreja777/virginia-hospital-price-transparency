import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served from https://<user>.github.io/<repo>/ — override with BASE_PATH in CI.
const base = process.env.BASE_PATH ?? '/virginia-hospital-price-transparency/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          map: ['maplibre-gl'],
          motion: ['motion'],
        },
      },
    },
    modulePreload: {
      // The map chunk is 1MB+ of MapLibre and is only ever needed once a
      // hospital map actually mounts (Procedure.jsx loads it lazily and only
      // once its container is in view). Without this, Vite's default
      // modulepreload polyfill still preloads every chunk reachable from the
      // entry point on every route, including this one.
      resolveDependencies: (_filename, deps) => deps.filter((d) => !d.includes('/map-')),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
