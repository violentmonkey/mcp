import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', schemas: 'src/schemas.ts' },
      formats: ['es'],
    },
    rollupOptions: { external: ['zod'] },
    minify: false,
  },
});
