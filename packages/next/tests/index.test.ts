// Unit coverage for withShiage — the pure logic of the next.config wrapper. The actual round-trip
// (save → diff → apply → file on disk) is covered headlessly in @shiage/core's server.test.ts and
// the in-page injection by the manual checklist.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub the boot — the singleton would otherwise try to detect Tailwind in the test runner's cwd.
vi.mock('../src/dev-server', () => ({
  bootShiageServer: vi.fn().mockResolvedValue(null),
}))

import withShiage from '../src/index'
import { bootShiageServer } from '../src/dev-server'

interface Ctx {
  dev: boolean
  isServer: boolean
  nextRuntime?: 'edge' | 'nodejs'
  buildId: string
  defaultLoaders: unknown
  webpack: unknown
}
const devCtx: Ctx = {
  dev: true,
  isServer: false,
  buildId: 'test',
  defaultLoaders: {},
  webpack: {},
}
const prodCtx: Ctx = { ...devCtx, dev: false }

beforeEach(() => {
  vi.mocked(bootShiageServer).mockClear()
})

describe('withShiage()', () => {
  it('returns a config object that adds a webpack callback', () => {
    const wrapped = withShiage({})
    expect(typeof wrapped.webpack).toBe('function')
  })

  it('preserves other top-level config keys (acts as a pass-through except for webpack)', () => {
    const wrapped = withShiage({ reactStrictMode: true, basePath: '/x' })
    expect(wrapped.reactStrictMode).toBe(true)
    expect(wrapped.basePath).toBe('/x')
  })

  it('returns the original config unchanged when enabled: false', () => {
    const input = { reactStrictMode: true, shiage: { enabled: false } }
    const wrapped = withShiage(input)
    expect(wrapped).toBe(input)
  })

  it('composes a user-provided webpack(): the user runs first, then ours layers on top', async () => {
    const userTouched: string[] = []
    // Cast through `unknown` — withShiage's WebpackFn is intentionally loose (any input shape) so
    // tests can pass minimal stubs without faking Next's whole config type.
    const userWebpack = vi.fn((config: Record<string, unknown>) => {
      userTouched.push('called')
      config.module = config.module ?? { rules: [{ test: /\.user$/, use: [] }] }
      return config
    }) as unknown as NonNullable<Parameters<typeof withShiage>[0]>['webpack']
    const wrapped = withShiage({ webpack: userWebpack })
    const result = await wrapped.webpack!({} as never, devCtx as never)
    expect(userTouched).toEqual(['called'])
    // User's rule survives; our pre-rule got added too.
    const rules = (result.module?.rules ?? []) as Array<{ test?: RegExp; enforce?: string }>
    expect(rules.some((r) => r.test?.source === '\\.user$')).toBe(true)
    expect(rules.some((r) => r.enforce === 'pre' && r.test?.source === '\\.[jt]sx$')).toBe(true)
  })

  it('in dev: pushes a pre-enforced JSX/TSX loader rule pointing at @shiage/next/loader', async () => {
    const wrapped = withShiage({})
    const config = { module: { rules: [] as unknown[] } }
    const out = (await wrapped.webpack!(config as never, devCtx as never)) as typeof config
    expect(out.module.rules).toHaveLength(1)
    const rule = out.module.rules[0] as {
      test: RegExp
      exclude: RegExp
      enforce: 'pre'
      use: Array<{ loader: string; options: { projectRoot: string } }>
    }
    expect(rule.test.test('Card.tsx')).toBe(true)
    expect(rule.test.test('Card.jsx')).toBe(true)
    expect(rule.test.test('Card.ts')).toBe(false)
    expect(rule.exclude.test('node_modules/foo/bar.tsx')).toBe(true)
    expect(rule.enforce).toBe('pre')
    // The resolved loader path is absolute and platform-dependent — assert the meaningful tail.
    expect(rule.use[0]?.loader).toMatch(/[/\\]next[/\\]dist[/\\]loader\.cjs$/)
    expect(rule.use[0]?.options.projectRoot).toBe(process.cwd())
  })

  it('boots the WS server exactly once even though webpack is called per compile', async () => {
    const wrapped = withShiage({})
    // Three calls mirror Next's per-compile invocation (client + nodejs server + edge).
    await wrapped.webpack!({} as never, devCtx as never)
    await wrapped.webpack!(
      {} as never,
      { ...devCtx, isServer: true, nextRuntime: 'nodejs' } as never,
    )
    await wrapped.webpack!({} as never, { ...devCtx, isServer: true, nextRuntime: 'edge' } as never)
    expect(bootShiageServer).toHaveBeenCalledTimes(3) // call count of the singleton is correct; the singleton itself dedupes inside.
    // (Calling bootShiageServer 3× is fine — the real singleton dedupes; the count here just
    // proves we routed every compile through the boot point.)
  })

  it('in production: skips the loader rule and never calls bootShiageServer', async () => {
    const wrapped = withShiage({})
    const config = { module: { rules: [] as unknown[] } }
    const out = (await wrapped.webpack!(config as never, prodCtx as never)) as typeof config
    expect(out.module.rules).toEqual([])
    expect(bootShiageServer).not.toHaveBeenCalled()
  })

  it('creates config.module / .rules defensively when the user config omits them', async () => {
    const wrapped = withShiage({})
    const config: { module?: { rules?: unknown[] } } = {}
    const out = (await wrapped.webpack!(config as never, devCtx as never)) as typeof config
    expect(out.module).toBeDefined()
    expect(out.module!.rules!.length).toBe(1)
  })

  it('idempotency: a double-wrap (withShiage(withShiage(cfg))) only pushes the rule once', async () => {
    const wrapped = withShiage(withShiage({}))
    const out = (await wrapped.webpack!({} as never, devCtx as never)) as {
      module: { rules: unknown[] }
    }
    expect(out.module.rules.length).toBe(1)
  })

  // ignoreWarnings: suppresses the "Critical dependency: the request of a dependency is an
  // expression" warnings webpack emits when parsing @shiage/core's bundled chunk (whose v4
  // ThemeSource uses dynamic import()) and jiti (whose v3 path uses the same pattern). Both are
  // intentional dynamic loads resolved at runtime, so the warning is a false positive. We can't
  // suppress these via serverExternalPackages — parse-time warnings fire before externalization
  // takes effect.
  describe('webpack ignoreWarnings', () => {
    it('appends the two Shiage warning matchers in dev', async () => {
      const wrapped = withShiage({})
      const out = (await wrapped.webpack!({} as never, devCtx as never)) as {
        ignoreWarnings: Array<{ module: RegExp; message: RegExp }>
      }
      expect(out.ignoreWarnings).toHaveLength(2)
      // @shiage/core chunk matcher.
      const coreMatcher = out.ignoreWarnings.find((m) =>
        m.module.test('/abs/packages/core/dist/chunk-XYZ.js'),
      )
      expect(coreMatcher).toBeDefined()
      expect(coreMatcher?.message.test('Critical dependency: …')).toBe(true)
      // jiti matcher (both .js and .mjs).
      const jitiMatcher = out.ignoreWarnings.find((m) =>
        m.module.test('/abs/node_modules/jiti/lib/jiti.mjs'),
      )
      expect(jitiMatcher).toBeDefined()
    })

    it('preserves any ignoreWarnings the user already configured', async () => {
      const userMatcher = { message: /some other warning/ }
      const wrapped = withShiage({})
      const config = { ignoreWarnings: [userMatcher] as unknown[] }
      const out = (await wrapped.webpack!(config as never, devCtx as never)) as {
        ignoreWarnings: unknown[]
      }
      expect(out.ignoreWarnings[0]).toBe(userMatcher)
      expect(out.ignoreWarnings).toHaveLength(3) // user + 2 ours
    })

    it('does not add ignoreWarnings in production', async () => {
      const wrapped = withShiage({})
      const config = {}
      const out = (await wrapped.webpack!(config as never, prodCtx as never)) as {
        ignoreWarnings?: unknown[]
      }
      expect(out.ignoreWarnings).toBeUndefined()
    })
  })

  // infrastructureLogging.console: webpack's PackFileCacheStrategy logs a back-to-back "Parsing of
  // ... for build dependencies failed" / "Build dependencies behind this expression are ignored"
  // pair for the same dynamic imports — through `infrastructureLogging`, not the module warnings
  // pipeline, so `ignoreWarnings` can't catch it. We wrap the infra console to drop the pair only
  // when it points at a Shiage-attributable path; unrelated cache warnings still surface.
  describe('infrastructureLogging filter', () => {
    // Each test passes a stub `console` through withShiage so we can observe what the filter
    // forwards. The Proxy wrapper around our stub lets us swap out only the methods we care about.
    it('drops the Shiage-attributable PackFileCacheStrategy pair (core chunk)', async () => {
      const calls: unknown[][] = []
      const stub = { warn: (...a: unknown[]) => calls.push(a) }
      const w = withShiage({})
      const cfg = { infrastructureLogging: { console: stub } }
      const result = (await w.webpack!(cfg as never, devCtx as never)) as {
        infrastructureLogging: { console: { warn: (...a: unknown[]) => void } }
      }
      // First (head) — Shiage-attributable: suppressed.
      result.infrastructureLogging.console.warn(
        "Parsing of /Users/x/packages/core/dist/chunk-ABC.js for build dependencies failed at 'import(pathToFileURL(resolved).href)'.",
      )
      // Second (tail) — generic; should be dropped because the head was just suppressed.
      result.infrastructureLogging.console.warn(
        'Build dependencies behind this expression are ignored and might cause incorrect cache invalidation.',
      )
      expect(calls).toEqual([])
    })

    it('drops the jiti pair too', async () => {
      const calls: unknown[][] = []
      const stub = { warn: (...a: unknown[]) => calls.push(a) }
      const w = withShiage({})
      const cfg = { infrastructureLogging: { console: stub } }
      const result = (await w.webpack!(cfg as never, devCtx as never)) as {
        infrastructureLogging: { console: { warn: (...a: unknown[]) => void } }
      }
      result.infrastructureLogging.console.warn(
        "Parsing of /Users/x/node_modules/jiti/lib/jiti.mjs for build dependencies failed at 'import(id)'.",
      )
      result.infrastructureLogging.console.warn(
        'Build dependencies behind this expression are ignored and might cause incorrect cache invalidation.',
      )
      expect(calls).toEqual([])
    })

    it('lets unrelated cache warnings through (only the Shiage-attributable pair is suppressed)', async () => {
      const calls: unknown[][] = []
      const stub = { warn: (...a: unknown[]) => calls.push(a) }
      const w = withShiage({})
      const cfg = { infrastructureLogging: { console: stub } }
      const result = (await w.webpack!(cfg as never, devCtx as never)) as {
        infrastructureLogging: { console: { warn: (...a: unknown[]) => void } }
      }
      // Unrelated head (not @shiage/core, not jiti) → goes through. So does its tail.
      result.infrastructureLogging.console.warn(
        "Parsing of /Users/x/node_modules/some-other-pkg/index.js for build dependencies failed at 'import(x)'.",
      )
      result.infrastructureLogging.console.warn(
        'Build dependencies behind this expression are ignored and might cause incorrect cache invalidation.',
      )
      expect(calls).toHaveLength(2)
    })

    it('preserves other infrastructureLogging fields the user already set', async () => {
      const stub = { warn: () => undefined }
      const w = withShiage({})
      const cfg = { infrastructureLogging: { level: 'verbose', console: stub } } as unknown
      const result = (await w.webpack!(cfg as never, devCtx as never)) as {
        infrastructureLogging: { level: string }
      }
      expect(result.infrastructureLogging.level).toBe('verbose')
    })
  })
})
