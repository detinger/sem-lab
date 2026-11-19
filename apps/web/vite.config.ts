import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// One config for dev server, production build and Vitest.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // "@/..." is declared once, in tsconfig.base.json ("paths"); Vite 8 reads it natively.
    tsconfigPaths: true,
  },
  // The estimation runtime's workers are ES modules (the estimate worker starts draw workers).
  worker: { format: 'es' },
  // Pre-bundle the dependencies that are first imported inside the engine workers or lazy
  // routes. Otherwise the dev server discovers them on first use, re-optimises and reloads the
  // page mid-session (seen as a cold-cache e2e flake).
  optimizeDeps: {
    include: [
      'ml-matrix',
      'elkjs/lib/elk.bundled.js',
      'papaparse',
      'dexie',
      'd3-scale',
      'd3-array',
      'zod',
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/tests/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
