import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: {
      external: (id) =>
        Object.keys(pkg.dependencies).some((d) => id === d || id.startsWith(`${d}/`)),
    },
    minify: false,
  },
});
