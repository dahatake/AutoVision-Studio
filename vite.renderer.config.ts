import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: 'src/renderer',
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: '../../dist/renderer',
  },
});
