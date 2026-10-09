import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

const external = [
  ...Object.keys(pkg.dependencies),
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
];

export default defineConfig({
  build: {
    target: 'node20',
    ssr: true,
    lib: {
      entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) =>
        external.some((e) => id === e || id.startsWith(`${e}/`)),
      output: {
        banner: (chunk) => (chunk.fileName === 'cli.js' ? '#!/usr/bin/env node' : ''),
      },
    },
    minify: false,
  },
});
