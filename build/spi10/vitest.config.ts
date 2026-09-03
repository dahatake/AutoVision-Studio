import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['spikes/annotation/CanvasSpike.test.tsx'],
    pool: 'forks',
    setupFiles: ['./tests/setup.ts'],
  },
});
