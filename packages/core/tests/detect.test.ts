import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectThemeSource } from '../src/tailwind/detect'

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures')

describe('detectThemeSource', () => {
  it('detects a Tailwind v4 project from its installed version + CSS entry', async () => {
    const source = await detectThemeSource(path.join(fixtures, 'tailwind-v4'))
    expect(source.version).toBe(4)
  })

  it('detects a Tailwind v3 project from its installed version + config', async () => {
    const source = await detectThemeSource(path.join(fixtures, 'tailwind-v3'))
    expect(source.version).toBe(3)
  })

  it('honors an explicit cssEntry override', async () => {
    const source = await detectThemeSource(path.join(fixtures, 'tailwind-v4'), {
      cssEntry: 'src/app.css',
    })
    expect(source.version).toBe(4)
  })

  it('throws a helpful error when the entry is missing for a forced version', async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'shiage-detect-'))
    await expect(detectThemeSource(empty, { version: 4 })).rejects.toThrow(/no CSS entry/)
    await expect(detectThemeSource(empty, { version: 3 })).rejects.toThrow(/no tailwind\.config/)
  })
})
