// CI canary for Tailwind v4's __unstable__ DesignSystem API — the project's #1 documented risk.
//
// @shiage/core's V4ThemeSource (src/tailwind/v4.ts) drives a *semi-private* Tailwind API:
// `__unstable__loadDesignSystem` plus the DesignSystem methods candidatesToCss / getClassList /
// canonicalizeCandidates / resolveThemeValue. This test pins down the raw shape of that surface,
// independent of our wrapper, so a breaking Tailwind bump fails *here* — loudly and pointing at the
// coupling — instead of surfacing as a baffling failure deep in the mapper. @tailwindcss/node is
// pinned to a tested minor (~4.3) in fixtures/tailwind-v4; bumping it intentionally re-runs this.
//
// If this fails after a Tailwind upgrade: the __unstable__ API changed. Re-verify the shapes below
// against the new version, then update src/tailwind/v4.ts and the tailwind-v4-designsystem-api memory.
import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// The narrow slice of the engine we depend on (mirrors the local interface in v4.ts).
interface DesignSystem {
  candidatesToCss(classes: string[]): (string | null)[]
  getClassList(): Array<[string, unknown]>
  canonicalizeCandidates(classes: string[], opts?: { rem?: number }): string[]
  resolveThemeValue(token: string): string | undefined
}
type LoadDesignSystem = (css: string, opts: { base: string }) => Promise<DesignSystem>

const fixtureBase = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/tailwind-v4/src',
)

describe('Tailwind v4 __unstable__ DesignSystem API (CI canary)', () => {
  let loadDesignSystem: unknown
  let ds: DesignSystem

  beforeAll(async () => {
    // Resolve @tailwindcss/node from the fixture project — exactly how V4ThemeSource finds it.
    const require = createRequire(path.join(fixtureBase, '__smoke__.js'))
    const mod = (await import(pathToFileURL(require.resolve('@tailwindcss/node')).href)) as {
      __unstable__loadDesignSystem?: LoadDesignSystem
    }
    loadDesignSystem = mod.__unstable__loadDesignSystem
    const css = readFileSync(path.join(fixtureBase, 'app.css'), 'utf8')
    ds = await (loadDesignSystem as LoadDesignSystem)(css, { base: fixtureBase })
  })

  it('still exports __unstable__loadDesignSystem as a function', () => {
    expect(typeof loadDesignSystem).toBe('function')
  })

  it('exposes the four DesignSystem methods the adapter drives', () => {
    expect(typeof ds.candidatesToCss).toBe('function')
    expect(typeof ds.getClassList).toBe('function')
    expect(typeof ds.canonicalizeCandidates).toBe('function')
    expect(typeof ds.resolveThemeValue).toBe('function')
  })

  it('candidatesToCss(["p-4"]) returns the .p-4 rule with a var()/calc() padding value', () => {
    const [css] = ds.candidatesToCss(['p-4'])
    expect(typeof css).toBe('string')
    expect(css).toMatch(/\.p-4\s*\{/)
    expect(css).toContain('padding')
    expect(css).toContain('var(--spacing)') // the var()+calc() shape ruleToDecls resolves
  })

  it('candidatesToCss returns null for an invalid candidate (the null contract classToDecls relies on)', () => {
    expect(ds.candidatesToCss(['shiage-zzz-not-a-real-class'])).toEqual([null])
  })

  it('resolveThemeValue("--spacing") resolves a token to a rem value', () => {
    const value = ds.resolveThemeValue('--spacing')
    expect(typeof value).toBe('string')
    expect(value).toMatch(/rem$/)
  })

  it('getClassList() returns [name, meta] entries we can enumerate', () => {
    const list = ds.getClassList()
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThan(0)
    expect(typeof list[0]![0]).toBe('string') // entry[0] is the class name
  })

  it('canonicalizeCandidates collapses an arbitrary px value to the scale (px↔rem)', () => {
    expect(ds.canonicalizeCandidates(['p-[16px]'], { rem: 16 })).toEqual(['p-4'])
  })
})
