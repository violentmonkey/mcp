import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@violentmonkey/mcp-protocol/schemas': src('./packages/protocol/src/schemas.ts'),
      '@violentmonkey/mcp-protocol': src('./packages/protocol/src/index.ts'),
      '@violentmonkey/mcp-client': src('./packages/client/src/index.ts'),
    },
  },
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
