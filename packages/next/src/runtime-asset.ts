// Resolves and caches the @shiage/runtime IIFE bytes for inlining into the dev page. Mirrors the
// Vite plugin's reader minus the watcher: in Next we read fresh on each ShiageDevScripts render and
// the process-level cache amortizes successive renders. We don't trigger HMR on runtime rebuilds —
// that's a shiage-maintainer-only concern and a page reload picks the new bytes up.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)

let cachedIifePath: string | null = null
let cachedIife: string | null = null

function resolveIifePath(): string {
  if (cachedIifePath === null) cachedIifePath = require.resolve('@shiage/runtime/iife')
  return cachedIifePath
}

/** The built runtime IIFE source, resolved from @shiage/runtime's published `./iife` export. */
export function readRuntimeIife(): string {
  if (cachedIife === null) cachedIife = readFileSync(resolveIifePath(), 'utf8')
  return cachedIife
}

/** Test-only: drop the in-memory cache so the next read pulls fresh bytes from disk. */
export function invalidateRuntimeIifeCache(): void {
  cachedIife = null
}
