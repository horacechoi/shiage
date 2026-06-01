// Two tsup builds:
//   1. ESM main entry + the React component — consumed by the user's next.config.* (ESM) and the
//      user's root layout / _document (SSR).
//   2. CJS-only loader — webpack require()s loader paths via Node's classic resolver, so the
//      loader must be CJS. @shiage/jsx-transform (ESM-only) is bundled into the loader via
//      `noExternal` so the require() doesn't need ESM interop at runtime.
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node18',
    external: ['react', 'react-dom', 'next', '@shiage/runtime'],
  },
  {
    entry: { loader: 'src/loader.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'node18',
    noExternal: ['@shiage/jsx-transform'],
    outExtension: () => ({ js: '.cjs' }),
  },
])
