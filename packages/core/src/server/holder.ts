// The framework-agnostic dev-server holder. It detects the project's Tailwind theme, builds the
// reverse-lookup, and stands up the WebSocket transport + protocol handler — keeping the live
// theme/lookup behind a getter so a config reload can swap them in place without rewiring the
// running handler. The Vite plugin and the Next plugin both glue this to their host's dev lifecycle
// identically; everything dev-server-shaped above the transport lives here, not in the plugins.
import { detectThemeSource, buildReverseLookup } from '../index'
import type { DetectOptions, ReverseLookup, ThemeSource } from '../index'
import { startWsServer } from './ws-server'
import { wireProtocol } from './protocol'

export interface ShiageServer {
  /** The free port the standalone WS server bound to (injected into the page as a meta tag). */
  readonly port: number
  /** Absolute path of the watched theme source, so the caller can wire a file watcher to reload. */
  readonly themeSourcePath: string
  /** Re-detect the theme, rebuild the lookup, and tell connected runtimes the config changed. */
  reload(): Promise<void>
  /** Terminate clients and stop listening. */
  close(): Promise<void>
}

/**
 * Detect Tailwind under `projectRoot`, build the reverse-lookup, and start the protocol WS server.
 * Throws if Tailwind can't be detected (the caller logs it and runs without the overlay).
 */
export async function startShiageServer(
  projectRoot: string,
  detectOptions: DetectOptions,
): Promise<ShiageServer> {
  let themeSource: ThemeSource = await detectThemeSource(projectRoot, detectOptions)
  let lookup: ReverseLookup = buildReverseLookup(themeSource, {
    rootFontSizePx: detectOptions.rootFontSizePx,
  })
  const themeSourcePath = themeSource.sourcePath

  // Read per message, so reload()'s new theme/lookup take effect on the next save with no rewiring.
  const handler = wireProtocol(() => ({ projectRoot, themeSource, lookup }))
  const server = await startWsServer({
    onMessage: (message, connection) => handler.handle(message, connection.send),
  })

  return {
    port: server.port,
    themeSourcePath,
    async reload() {
      themeSource = await detectThemeSource(projectRoot, detectOptions)
      lookup = buildReverseLookup(themeSource, { rootFontSizePx: detectOptions.rootFontSizePx })
      server.broadcast({ type: 'config-reloaded' })
    },
    close: () => server.close(),
  }
}
