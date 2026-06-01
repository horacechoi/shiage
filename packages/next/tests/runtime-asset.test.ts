// Coverage for the IIFE reader's read + cache loop. (The Vite plugin's runtime-asset.test.ts
// covers the watcher + full inject; @shiage/next doesn't watch — see runtime-asset.ts's comment.)
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { invalidateRuntimeIifeCache, readRuntimeIife } from '../src/runtime-asset'

const require = createRequire(import.meta.url)
const iifePath = require.resolve('@shiage/runtime/iife')
const originalBytes = readFileSync(iifePath)

afterEach(() => {
  // Restore so we don't bleed test bytes into the Vite suite (which reads the same file).
  writeFileSync(iifePath, originalBytes)
  invalidateRuntimeIifeCache()
})

describe('readRuntimeIife', () => {
  it('returns the built IIFE source and caches across calls', () => {
    invalidateRuntimeIifeCache()
    const a = readRuntimeIife()
    const b = readRuntimeIife()
    expect(a).toBe(b)
    expect(a).toContain('ShiageRuntime') // tsup `globalName` from @shiage/runtime
    expect(a.length).toBeGreaterThan(1000)
  })

  it('invalidateRuntimeIifeCache forces the next read to hit disk', () => {
    invalidateRuntimeIifeCache()
    const first = readRuntimeIife()
    writeFileSync(iifePath, '// marker\n')
    invalidateRuntimeIifeCache()
    expect(readRuntimeIife()).toBe('// marker\n')
    expect(readRuntimeIife()).not.toBe(first)
  })
})
