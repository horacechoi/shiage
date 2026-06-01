// Process-global singleton wrapping @shiage/core's startShiageServer for Next.js. Next invokes
// next.config.js's `webpack` callback up to three times in dev (client + nodejs server + edge), so
// we must boot exactly once. The promise is keyed on a Symbol stored on globalThis so even
// repeated module evaluations in the dev process see the same boot.
//
// The Vite plugin owns its server holder inside the configureServer lifecycle (one plugin
// instance per server); Next has no equivalent hook — config is static — so a process-global is
// the natural fit. Process exit listeners tear the server down.
import { startShiageServer, type ShiageServer } from '@shiage/core/server'
import { readRuntimeIife } from './runtime-asset'
import { watchThemeSource } from './watch-config'

export interface BootOptions {
  /** Override Tailwind auto-detection. */
  tailwind?: {
    version?: 3 | 4
    cssEntry?: string
    configPath?: string
  }
  /** Page root font-size in px for rem↔px normalization (default 16). */
  rootFontSizePx?: number
}

export interface DevState {
  /** WS server port — injected into the page as `<meta name="shiage-ws-port" content={...}>`. */
  readonly port: number
  /** The runtime IIFE bytes to inline as `<script>`. */
  readonly runtimeIife: string
}

const KEY = Symbol.for('shiage.next.devServer')
interface Slot {
  promise: Promise<DevState | null>
  state: DevState | null
  resolved: boolean
  server: ShiageServer | null
  disposeWatch: (() => void) | null
}
type GlobalWithSlot = typeof globalThis & { [KEY]?: Slot }

/**
 * Kick off the WS server boot if it hasn't started yet. Returns a promise that resolves to the dev
 * state (port + runtime IIFE) on success, or `null` if Tailwind couldn't be detected — in which
 * case the overlay is silently disabled and dev continues. Subsequent calls return the same
 * promise (singleton): the per-compile webpack callbacks all `await` the same boot.
 */
export function bootShiageServer(
  projectRoot: string,
  options: BootOptions = {},
): Promise<DevState | null> {
  const g = globalThis as GlobalWithSlot
  const existing = g[KEY]
  if (existing) return existing.promise

  const detect = {
    version: options.tailwind?.version,
    cssEntry: options.tailwind?.cssEntry,
    configPath: options.tailwind?.configPath,
    rootFontSizePx: options.rootFontSizePx,
  }

  const slot: Slot = {
    promise: undefined as unknown as Promise<DevState | null>,
    state: null,
    resolved: false,
    server: null,
    disposeWatch: null,
  }
  g[KEY] = slot

  slot.promise = (async (): Promise<DevState | null> => {
    let server: ShiageServer
    try {
      server = await startShiageServer(projectRoot, detect)
    } catch (err) {
      // No Tailwind, or detection failed: leave the page untouched rather than break dev.
       
      console.warn(`[shiage] overlay disabled — ${(err as Error).message}`)
      slot.resolved = true
      return null
    }
    slot.server = server
    slot.disposeWatch = watchThemeSource(server.themeSourcePath, () => {
      server.reload().catch((err) => {
         
        console.warn(`[shiage] theme reload failed: ${(err as Error).message}`)
      })
    })

    const runtimeIife = readRuntimeIife()
    const state: DevState = { port: server.port, runtimeIife }
    slot.state = state
    slot.resolved = true

     
    console.info(`  ➜  shiage:   editing live on ws://localhost:${server.port}`)
    return state
  })()

  // One-shot teardown on process exit. We register late so process.exit() in user code still wins.
  const cleanup = (): void => {
    slot.disposeWatch?.()
    slot.disposeWatch = null
    slot.server?.close().catch(() => {})
    slot.server = null
  }
  process.once('beforeExit', cleanup)
  process.once('SIGINT', cleanup)
  process.once('SIGTERM', cleanup)

  return slot.promise
}

/** Sync read of the booted state. Returns `null` if boot hasn't resolved or failed. */
export function getDevState(): DevState | null {
  const g = globalThis as GlobalWithSlot
  return g[KEY]?.state ?? null
}

/** Test-only: drop the singleton so the next boot starts cleanly. Closes the running server. */
export async function __resetDevServerForTests(): Promise<void> {
  const g = globalThis as GlobalWithSlot
  const slot = g[KEY]
  if (!slot) return
  slot.disposeWatch?.()
  if (slot.server) await slot.server.close()
  delete g[KEY]
}
