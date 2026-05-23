import { defineConfig } from 'tsup'

// The runtime ships as a single browser IIFE that the Vite/Next plugins inline into the page.
export default defineConfig({
  entry: { 'shiage-runtime': 'src/index.ts' },
  format: ['iife'],
  globalName: 'ShiageRuntime',
  platform: 'browser',
  target: 'es2020',
  clean: true,
  minify: false,
  sourcemap: false,
  outExtension() {
    return { js: '.iife.js' }
  },
})
