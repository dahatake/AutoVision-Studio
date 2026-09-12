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
  },
});
