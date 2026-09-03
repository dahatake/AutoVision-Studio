import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';

const repositoryUrl = new URL('../../', import.meta.url);
const buildSourceFiles = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'spikes/annotation/CanvasSpike.tsx',
  'build/spi10/benchmark-entry.ts',
  'build/spi10/index.html',
  'build/spi10/vite.config.ts',
] as const;
const buildSourceHashes = Object.fromEntries(
  buildSourceFiles.map((relativePath) => [
    relativePath,
    createHash('sha256')
      .update(readFileSync(new URL(relativePath, repositoryUrl)))
      .digest('hex')
      .toUpperCase(),
  ]),
);

export default defineConfig({
  root: 'build/spi10',
  base: './',
  define: {
    __SPI10_BUILD_SOURCE_HASHES__: JSON.stringify(buildSourceHashes),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
