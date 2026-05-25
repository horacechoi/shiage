import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // Resolve @shiage/core (and its browser-safe subpaths) to TypeScript source rather than built
  // dist, so the whole suite is green from a clean clone without a prior `pnpm build`. The IIFE
  // build (tsup) still resolves the real dist subpaths — see packages/runtime.
  resolve: {
    alias: [
      {
        find: /^@shiage\/core\/supported$/,
        replacement: fromRoot('./packages/core/src/supported.ts'),
      },
      {
        find: /^@shiage\/core\/protocol$/,
        replacement: fromRoot('./packages/core/src/protocol/index.ts'),
      },
      {
        find: /^@shiage\/core\/server$/,
        replacement: fromRoot('./packages/core/src/server/index.ts'),
      },
      { find: /^@shiage\/core$/, replacement: fromRoot('./packages/core/src/index.ts') },
      {
        find: /^@shiage\/jsx-transform$/,
        replacement: fromRoot('./packages/jsx-transform/src/index.ts'),
      },
    ],
  },
  test: {
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
