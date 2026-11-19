import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// One config for dev server, production build and Vitest.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // "@/..." is declared once, in tsconfig.base.json ("paths"); Vite 8 reads it natively.
    tsconfigPaths: true,
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
