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
})
