import { isBuiltin } from 'node:module';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/preload/index.ts',
      fileName: 'index',
      formats: ['cjs'],
    },
    outDir: 'dist/preload',
    rollupOptions: {
      external: (id) => id === 'electron' || isBuiltin(id),
    },
  },
});
