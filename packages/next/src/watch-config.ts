// Watches the project's Tailwind theme source (the v4 CSS entry or v3 config) and fires `onChange`
// when it's edited. The Vite plugin can piggyback on Vite's chokidar; the Next plugin doesn't have
// that affordance, so we use node:fs.watch directly with the same dirname+basename + debounce trick
// the Vite plugin's runtime-asset watcher uses (single-file watches on macOS frequently miss
// truncate-then-write events; watching the directory and filtering by name is reliable).
import { watch as fsWatch } from 'node:fs'
import { basename, dirname, resolve as resolvePath } from 'node:path'

/** Start watching `sourcePath`; returns a disposer that detaches the watcher. */
export function watchThemeSource(sourcePath: string, onChange: () => void): () => void {
  const target = resolvePath(sourcePath)
  const file = basename(target)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const watcher = fsWatch(dirname(target), (_event, changed) => {
    if (changed !== file) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(onChange, 50)
  })
  return () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    watcher.close()
  }
}
