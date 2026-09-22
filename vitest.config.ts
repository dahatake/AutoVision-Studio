import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    css: {
      include: [/\/src\/renderer\/styles\/(?:tokens|global)\.css(?:\?.*)?$/],
    },
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    pool: 'threads',
    setupFiles: ['./tests/setup.ts'],
    // Several Main suites drive the real filesystem, real SQLite and real child
    // processes. Vitest's 5 s default expires on a loaded machine and reports a
    // timeout that looks like a product failure, so allow a realistic budget.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
