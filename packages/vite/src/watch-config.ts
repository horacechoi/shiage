// Watches the project's Tailwind theme source (the v4 CSS entry or v3 config) and fires `onChange`
// when it's edited, so the plugin can rebuild the reverse-lookup and broadcast `config-reloaded`.
// We reuse Vite's own chokidar watcher rather than spinning up a second one.
import path from 'node:path'
import type { ViteDevServer } from 'vite'

/** Start watching `sourcePath`; returns a disposer that detaches the listener. */
export function watchThemeSource(
  server: ViteDevServer,
  sourcePath: string,
  onChange: () => void,
): () => void {
  const target = path.resolve(sourcePath)
  server.watcher.add(target)
  const handler = (changed: string): void => {
    if (path.resolve(changed) === target) onChange()
  }
  server.watcher.on('change', handler)
  return () => {
    server.watcher.off('change', handler)
  }
}
