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
    // Half of the logical CPUs, to reduce the number of real child processes (mountvol.exe probes,
    // JOB04 workers) started at once in the aggregate run; under load such a process has been observed
    // to outlive its fixed product bound (work/20260926-0810-EXT-X1-ThreadpoolCompare.md section 7).
    maxWorkers: '50%',
    setupFiles: ['./tests/setup.ts'],
    // Several Main suites drive the real filesystem, real SQLite and real child
    // processes. Vitest's 5 s default expires on a loaded machine and reports a
    // timeout that looks like a product failure, so allow a realistic budget.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
