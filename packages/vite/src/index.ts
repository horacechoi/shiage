// @shiage/vite — the Vite plugin that wires Shiage into a dev server. It is the v1 integration
// point: it stamps source locations onto JSX (so a picked DOM node maps back to a file), inlines
// the browser runtime + its WS port into the page, and runs a standalone WebSocket server that
// turns a "save" into a previewed-then-written Tailwind class edit.
//
// Lifecycle:
//   configResolved   → remember the project root
//   configureServer  → detect Tailwind, build the reverse-lookup, start the WS server, watch the
//                      theme source (reload + broadcast on change)
//   transform        → stamp data-shiage-loc on .jsx/.tsx (before @vitejs/plugin-react compiles JSX)
//   transformIndexHtml → inject <meta shiage-ws-port> + the runtime IIFE
//
// `apply: 'serve'` makes the whole plugin a true no-op in production builds.
import { transformSync } from '@babel/core'
import shiageStampPlugin from '@shiage/jsx-transform'
import type { Plugin, TransformResult } from 'vite'
import { startShiageServer, type ShiageServer } from './ws-server'
import { watchThemeSource } from './watch-config'
import { runtimeInjectionTags } from './runtime-asset'

export interface ShiageOptions {
  /** Override Tailwind auto-detection (version, and the v4 CSS entry or v3 config path). */
  tailwind?: {
    version?: 3 | 4
    /** v4 CSS entry importing "tailwindcss", relative to the project root or absolute. */
    cssEntry?: string
    /** v3 config path, relative to the project root or absolute. */
    configPath?: string
  }
  /** Page root font-size in px for rem↔px normalization (default 16). */
  rootFontSizePx?: number
  /** Disable the plugin entirely. Default true. (It is already inert in `vite build`.) */
  enabled?: boolean
}

const JSX_FILE = /\.[jt]sx$/

export default function shiage(options: ShiageOptions = {}): Plugin {
  const enabled = options.enabled ?? true
  let projectRoot = process.cwd()
  let server: ShiageServer | null = null
  let disposeWatch: (() => void) | null = null

  async function shutdown(): Promise<void> {
    disposeWatch?.()
    disposeWatch = null
    const closing = server?.close()
    server = null
    await closing
  }

  return {
    name: 'shiage',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      projectRoot = config.root
    },

    async configureServer(viteServer) {
      if (!enabled) return
      const { logger } = viteServer.config
      try {
        server = await startShiageServer(projectRoot, {
          version: options.tailwind?.version,
          cssEntry: options.tailwind?.cssEntry,
          configPath: options.tailwind?.configPath,
          rootFontSizePx: options.rootFontSizePx,
        })
      } catch (err) {
        // No Tailwind, or detection failed: leave the page untouched rather than break dev.
        logger.warn(`[shiage] overlay disabled — ${(err as Error).message}`)
        return
      }

      disposeWatch = watchThemeSource(viteServer, server.themeSourcePath, () => {
        server
          ?.reload()
          .catch((err) => logger.warn(`[shiage] theme reload failed: ${(err as Error).message}`))
      })
      logger.info(`  ➜  shiage:   editing live on ws://localhost:${server.port}`, {
        clear: false,
        timestamp: true,
      })

      // Tear the standalone WS server down when Vite closes or restarts (which recreates the plugin).
      viteServer.httpServer?.once('close', () => void shutdown())
    },

    transform(code, id) {
      if (!enabled || !JSX_FILE.test(id) || id.includes('/node_modules/')) return null
      const result = transformSync(code, {
        filename: id,
        root: projectRoot,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [[shiageStampPlugin, { projectRoot }]],
      })
      if (!result?.code) return null
      return { code: result.code, map: result.map as TransformResult['map'] }
    },

    transformIndexHtml() {
      if (!enabled || !server) return
      return runtimeInjectionTags(server.port)
    },
  }
}
