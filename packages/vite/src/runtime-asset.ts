// Locates the built @shiage/runtime IIFE and turns it into the tags injected into the dev page.
// The runtime ships as a single self-mounting IIFE, so we inline it directly into a <script> (no
// extra request, no public asset route) alongside a <meta> that tells it which WebSocket port to
// dial. Reading is cached — the IIFE doesn't change within a dev session.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { HtmlTagDescriptor } from 'vite'

const require = createRequire(import.meta.url)

let cachedIife: string | null = null

/** The built runtime IIFE source, resolved from @shiage/runtime's published `./iife` export. */
export function readRuntimeIife(): string {
  if (cachedIife === null) {
    cachedIife = readFileSync(require.resolve('@shiage/runtime/iife'), 'utf8')
  }
  return cachedIife
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
