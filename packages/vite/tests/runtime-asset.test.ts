// Coverage for the IIFE inline + watch loop. The watcher itself uses node:fs.watch, which is
// best-effort and event-timing-sensitive; we drive a real change against the actual
// `@shiage/runtime/iife` file (the same path the plugin resolves at runtime) and verify the cache
// invalidates + the onChange callback fires.
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, utimesSync } from 'node:fs'
import {
  invalidateRuntimeIifeCache,
  readRuntimeIife,
  runtimeInjectionTags,
  watchRuntimeIife,
} from '../src/runtime-asset'

const require = createRequire(import.meta.url)
const iifePath = require.resolve('@shiage/runtime/iife')
const originalBytes = readFileSync(iifePath)

afterEach(() => {
  // Restore the original bytes + mtime so we don't bleed into other tests or the next dev run.
  writeFileSync(iifePath, originalBytes)
  invalidateRuntimeIifeCache()
})

describe('readRuntimeIife', () => {
  it('returns the built IIFE source and caches across calls', () => {
    invalidateRuntimeIifeCache()
    const a = readRuntimeIife()
    const b = readRuntimeIife()
    expect(a).toBe(b)
    expect(a).toContain('ShiageRuntime') // tsup `globalName` we set in tsup.config.ts
    expect(a.length).toBeGreaterThan(1000)
  })

  it('invalidateRuntimeIifeCache forces the next read to hit disk', () => {
    invalidateRuntimeIifeCache()
    const first = readRuntimeIife()
    // Truncate the dist file to a marker; without invalidation the cache would still return `first`.
    writeFileSync(iifePath, '// marker\n')
    invalidateRuntimeIifeCache()
    expect(readRuntimeIife()).toBe('// marker\n')
    expect(readRuntimeIife()).not.toBe(first)
  })
})

describe('runtimeInjectionTags', () => {
  it('emits a shiage-ws-port meta + an inlined script with the IIFE body', () => {
    invalidateRuntimeIifeCache()
    const tags = runtimeInjectionTags(54321)
    expect(tags).toHaveLength(2)
    expect(tags[0]).toMatchObject({
      tag: 'meta',
      attrs: { name: 'shiage-ws-port', content: '54321' },
      injectTo: 'head',
    })
    expect(tags[1]?.tag).toBe('script')
    expect(typeof tags[1]?.children).toBe('string')
    expect((tags[1]?.children as string).length).toBeGreaterThan(1000)
  })
})

describe('watchRuntimeIife', () => {
  it('clears the cache and calls onChange when the IIFE file is rewritten', async () => {
    invalidateRuntimeIifeCache()
    const first = readRuntimeIife()

    let fired = 0
    const teardown = watchRuntimeIife(() => {
      fired += 1
    })

    try {
      // Mimic a tsup --watch rebuild: write fresh bytes to the same path. We then bump mtime to
      // make sure fs.watch sees the change on filesystems that compare by mtime granularity.
      writeFileSync(iifePath, '// new\n')
      const now = new Date()
      utimesSync(iifePath, now, now)

      // The watcher debounces 50ms — give it a comfortable margin to fire.
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(fired).toBeGreaterThanOrEqual(1)
      expect(readRuntimeIife()).toBe('// new\n')
      expect(readRuntimeIife()).not.toBe(first)
    } finally {
      teardown()
    }
  })

  it('teardown closes the watcher (no further onChange after teardown)', async () => {
    invalidateRuntimeIifeCache()
    let fired = 0
    const teardown = watchRuntimeIife(() => {
      fired += 1
    })
    teardown()
    writeFileSync(iifePath, '// post-teardown\n')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(fired).toBe(0)
  })
})
