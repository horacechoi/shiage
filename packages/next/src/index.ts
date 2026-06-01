// @shiage/next — the Next.js plugin (webpack/Babel path). Wrap your next config with
// `withShiage(...)` and add `<ShiageDevScripts />` to the root layout / _document. The dev script
// must use webpack (Turbopack ignores the webpack() callback): `next dev --webpack` on Next 16+,
// or omit the Turbopack flag on Next 15.
//
// Lifecycle (analogous to the Vite plugin's configureServer/transform/transformIndexHtml triple):
//   webpack(config, ctx)        → compose user's webpack first, then in dev:
//                                  1) fire-and-forget the singleton WS-server boot (Tailwind
//                                     detect + ws bind + theme watcher). The bind is sub-ms; by
//                                     the time SSR runs, state is sync-available. Awaiting here
//                                     would force a Promise return and trip Next's
//                                     "Promise returned in next config" warning.
//                                  2) prepend a pre-enforced loader rule stamping data-shiage-loc
//                                     on .tsx/.jsx before SWC compiles JSX away
//   <ShiageDevScripts />        → SSR-only sync component that emits the shiage-ws-port meta + the
//                                  inlined runtime IIFE in dev; renders null in production
//
// Production (next build / next start): webpack callback no-ops, no ws server boot, no loader rule,
// no scripts emitted — fully inert.
import { createRequire } from 'node:module'
import { bootShiageServer, type BootOptions } from './dev-server'

export { ShiageDevScripts } from './dev-scripts'

/** The options accepted by `withShiage` — the same shape as `@shiage/vite`'s `ShiageOptions`. */
export interface ShiageOptions extends BootOptions {
  /** Disable the plugin entirely (default: true). It's already inert in production builds. */
  enabled?: boolean
}

// Minimal subset of Next's config / webpack-callback context we touch. Typed loosely so the plugin
// works against Next 14, 15, and 16 without importing `next/dist` types (whose paths drift).
interface WebpackCtx {
  dev: boolean
  isServer: boolean
  nextRuntime?: 'edge' | 'nodejs'
  buildId: string
  defaultLoaders: unknown
  webpack: unknown
}
type WebpackFn = (config: WebpackConfig, ctx: WebpackCtx) => WebpackConfig | Promise<WebpackConfig>
interface WebpackConfig {
  module?: { rules?: WebpackRule[] }
  [k: string]: unknown
}
interface WebpackRule {
  test?: RegExp
  exclude?: RegExp
  enforce?: 'pre' | 'post'
  use?: Array<{ loader: string; options?: unknown }>
  [k: string]: unknown
}
export interface NextConfigLike {
  webpack?: WebpackFn
  [k: string]: unknown
}

const JSX_FILE = /\.[jt]sx$/
// Marks our loader rule so a `withShiage(withShiage(config))` double-wrap doesn't double-push.
// Symbol key: webpack 5 validates rule objects with a strict schema (`Object.keys` on the rule),
// which would reject any unknown string property. Symbols are invisible to `Object.keys` so
// they slip past the validator while still letting us check membership at runtime.
const SHIAGE_LOADER_MARK = Symbol.for('shiage.next.loaderMark')

const require = createRequire(import.meta.url)

function resolveLoaderPath(): string {
  // The CJS loader sits next to this ESM module in dist/. Resolve via the package's own export so
  // monorepo path quirks (pnpm symlinks) and downstream installs both work identically.
  return require.resolve('@shiage/next/loader')
}

/**
 * Wrap a Next.js config to enable Shiage in dev. Composes any user-defined `webpack(...)`:
 *
 *   import withShiage from '@shiage/next'
 *   export default withShiage({ ... })   // next.config.mjs / next.config.ts
 *
 * Webpack is invoked three times per dev (client + nodejs server + edge); we boot the WS server
 * exactly once (singleton-guarded) and add the loader rule to every compile so SSR and CSR markup
 * match. `enabled: false`, `dev: false`, and Turbopack all degrade to a no-op.
 */
export default function withShiage<C extends NextConfigLike>(
  nextConfig: C = {} as C,
): C & { webpack?: WebpackFn } {
  const options: ShiageOptions = ((nextConfig as { shiage?: ShiageOptions }).shiage ??
    {}) as ShiageOptions
  const enabled = options.enabled ?? true
  if (!enabled) return nextConfig

  const userWebpack = nextConfig.webpack

  // Add our pre-rule to `next.module.rules` in-place. Pulled out so both the sync and async return
  // paths reuse it without duplicating loader-resolve and the idempotency check.
  function addLoaderRule(next: WebpackConfig): void {
    next.module ??= {}
    next.module.rules ??= []
    const alreadyAdded = next.module.rules.some(
      (r): r is WebpackRule =>
        r !== null &&
        typeof r === 'object' &&
        (r as Record<symbol, unknown>)[SHIAGE_LOADER_MARK] === true,
    )
    if (alreadyAdded) return
    const projectRoot = process.cwd()
    const rule: WebpackRule & { [SHIAGE_LOADER_MARK]: true } = {
      test: JSX_FILE,
      exclude: /node_modules/,
      // `enforce: 'pre'` is critical: it puts our loader in the pre phase so it runs before
      // Next's normal SWC loader. Without it, SWC would consume JSX first and there'd be no
      // JSXOpeningElement left for the Babel stamp to visit.
      enforce: 'pre',
      use: [{ loader: resolveLoaderPath(), options: { projectRoot } }],
      [SHIAGE_LOADER_MARK]: true,
    }
    next.module.rules.push(rule)
  }

  const wrappedWebpack: WebpackFn = (config, ctx) => {
    const userResult = userWebpack ? userWebpack(config, ctx) : config

    // Production builds: pass through whatever the user returned. No instrumentation.
    if (!ctx.dev) return userResult

    // Fire-and-forget the singleton WS server boot. The bind is sub-millisecond; by the time SSR
    // runs (after webpack compile completes), state is sync-available to <ShiageDevScripts />.
    // Awaiting here would mean we always return a Promise — which trips Next's
    // "Promise returned in next config" warning. Sync-when-possible is the cleaner UX.
    void bootShiageServer(process.cwd(), options)

    // If the user's webpack is async, propagate the Promise (Next would warn either way — the
    // user opted into async); otherwise stay sync.
    if (userResult instanceof Promise) {
      return userResult.then((next) => {
        addLoaderRule(next)
        return next
      })
    }
    addLoaderRule(userResult)
    return userResult
  }

  return { ...nextConfig, webpack: wrappedWebpack }
}
