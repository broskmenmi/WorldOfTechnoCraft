import { defineConfig } from 'vite';

// COOP/COEP from day one: cross-origin isolation unlocks SharedArrayBuffer and
// precise memory measurement later, and production hosting (public/_headers)
// ships the same headers — dev must match prod.
const coopCoep = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: coopCoep },
  preview: { headers: coopCoep },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        index: 'index.html',
        bench: 'bench.html',
      },
    },
  },
});
