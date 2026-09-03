import { defineConfig } from 'vite';

export default defineConfig({
  root: 'build/spi10',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
