// Locates the built @shiage/runtime IIFE and turns it into the tags injected into the dev page.
// The runtime ships as a single self-mounting IIFE, so we inline it directly into a <script> (no
// extra request, no public asset route) alongside a <meta> that tells it which WebSocket port to
// dial.
//
// Cache invalidation: the IIFE bytes are cached in memory (one read on first injection), but the
// resolved path is also exposed via `watchRuntimeIife` so the plugin can wire an `fs.watch` that
// clears the cache + triggers a Vite full-reload whenever the runtime is rebuilt. That closes the
// dev loop: with `@shiage/runtime`'s `tsup --watch` running alongside `vite`, edits to
// `packages/runtime/src/**` flow into the page without a server restart.
import { createRequire } from 'node:module'
import { readFileSync, watch as fsWatch } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { HtmlTagDescriptor } from 'vite'

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

/**
 * Watch the resolved IIFE file for changes (which happen when `@shiage/runtime`'s tsup --watch
 * rewrites it after a source edit). On any change, drop the in-memory cache so the next
 * `transformIndexHtml` returns fresh bytes, then notify the caller — typically the Vite plugin,
 * which uses it to trigger a full page reload over Vite's HMR socket. Returns a teardown.
 *
 * `fs.watch` semantics differ across platforms (some editors truncate-then-write, some swap inode);
 * a 50ms debounce coalesces the duplicate events that result and gives the writer a moment to
 * finish before we read. We always invalidate the cache on the first event of a burst, even though
 * onChange only fires once at the end — that way a fast in-flight transformIndexHtml after the
 * initial event still picks up the new bytes.
 */
export function watchRuntimeIife(onChange: () => void): () => void {
  // Watch the parent directory and filter by basename rather than watching the file directly:
  // on macOS, fs.watch on a single file (FSEvents) frequently misses change events when the
  // writer truncates + rewrites the same path (tsup does exactly this). Directory watches catch
  // it reliably across platforms.
  const path = resolveIifePath()
  const file = basename(path)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const watcher = fsWatch(dirname(path), (_event, changed) => {
    if (changed !== file) return
    cachedIife = null
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(onChange, 50)
  })
  return () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    watcher.close()
  }
}

/**
 * The HTML tags Shiage injects into the dev page: the `shiage-ws-port` meta the runtime reads to
 * build its WebSocket URL, then the runtime IIFE inlined as a body script (it auto-mounts on load).
 */
export function runtimeInjectionTags(wsPort: number): HtmlTagDescriptor[] {
  return [
    {
      tag: 'meta',
      attrs: { name: 'shiage-ws-port', content: String(wsPort) },
      injectTo: 'head',
    },
    {
      tag: 'script',
      children: readRuntimeIife(),
      injectTo: 'body',
    },
  ]
}
