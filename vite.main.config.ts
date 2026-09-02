import { isBuiltin } from 'node:module';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      fileName: 'index',
      formats: ['es'],
    },
    outDir: 'dist/main',
    rollupOptions: {
      external: (id) => id === 'electron' || isBuiltin(id),
    },
  },
});
