import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import type { CssDecl, ThemeSource } from './types'
import { resolveValue } from './resolve-value'
import { expandToPhysical } from './expand'
import { prefixesForNamespaces } from '../mapper/groups'

// Minimal local view of the bits of Tailwind v4's DesignSystem we drive. The real API is
// __unstable__ (see the tailwind-v4-designsystem-api memory), so we depend on a narrow local
// interface rather than Tailwind's exported types, and resolve the package from the user's
// project at runtime — never bundling or statically importing it.
interface DesignSystem {
  candidatesToCss(classes: string[]): (string | null)[]
  getClassList(): Array<[string, unknown]>
  canonicalizeCandidates(classes: string[], opts?: { rem?: number; collapse?: boolean }): string[]
  resolveThemeValue(token: string, forceInline?: boolean): string | undefined
}
interface TailwindNodeModule {
  __unstable__loadDesignSystem(css: string, opts: { base: string }): Promise<DesignSystem>
}

export interface CreateV4Options {
  /** Root font size for rem↔px normalization. Defaults to 16. */
  rootFontSizePx?: number
}

/**
 * Build a ThemeSource for a Tailwind v4 project by loading its design system from the CSS entry
 * (the file with `@import "tailwindcss"` / `@theme`). The engine is resolved from the project
 * containing that CSS, so it matches the user's installed Tailwind version exactly.
 */
export async function createV4ThemeSource(
  cssEntryPath: string,
  options: CreateV4Options = {},
): Promise<ThemeSource> {
  const base = path.dirname(cssEntryPath)
  const css = readFileSync(cssEntryPath, 'utf8')
  const mod = await loadTailwindNode(base)
  const ds = await mod.__unstable__loadDesignSystem(css, { base })
  const rootFontSizePx = options.rootFontSizePx ?? 16
  const resolveToken = (token: string): string | undefined => ds.resolveThemeValue(token)

  return {
    version: 4,
    sourcePath: cssEntryPath,

    classToDecls(classNames) {
      const generated = ds.candidatesToCss(classNames)
      return generated.map((cssText) =>
        cssText == null ? [] : ruleToDecls(cssText, resolveToken, rootFontSizePx),
      )
    },

    enumerateCandidates(namespaces) {
      const prefixes = new Set(prefixesForNamespaces(namespaces))
      const out: string[] = []
      for (const entry of ds.getClassList()) {
        const name = entry[0]
        if (matchesPrefix(name, prefixes)) out.push(name)
      }
      return out
    },

    canonicalize(classNames, fontSizePx) {
      try {
        return ds.canonicalizeCandidates(classNames, { rem: fontSizePx })
      } catch {
        return classNames
      }
    },

    resolveToken,
  }
}

async function loadTailwindNode(base: string): Promise<TailwindNodeModule> {
  const require = createRequire(path.join(base, '__shiage__.js'))
  let resolved: string
  try {
    resolved = require.resolve('@tailwindcss/node')
  } catch {
    throw new Error(
      `[shiage] Could not resolve "@tailwindcss/node" from ${base}. It ships with Tailwind v4 ` +
        `tooling (@tailwindcss/vite, @tailwindcss/postcss, …); install it to use Shiage with Tailwind v4.`,
    )
  }
  return (await import(pathToFileURL(resolved).href)) as unknown as TailwindNodeModule
}

/**
 * Parse a single generated CSS rule into normalized physical declarations:
 * take only the first `.class { … }` block (ignore trailing `@property` rules), drop custom
 * properties, resolve `var()`/`calc()`, drop anything still referencing an unresolved internal
 * `var()` (Tailwind's `--tw-*` plumbing), and expand shorthands/logical props to physical longhands.
 */
function ruleToDecls(
  cssText: string,
  resolveToken: (token: string) => string | undefined,
  rootFontSizePx: number,
): CssDecl[] {
  const block = firstRuleBlock(cssText)
  if (block === null) return []
  const decls: CssDecl[] = []
  for (const statement of block.split(';')) {
    const colon = statement.indexOf(':')
    if (colon < 0) continue
    const property = statement.slice(0, colon).trim().toLowerCase()
    if (!property || property.startsWith('--')) continue
    const raw = statement.slice(colon + 1).trim()
    if (!raw) continue
    const value = resolveValue(raw, { resolveToken, rootFontSizePx })
    // Unresolved var() (e.g. --tw-border-style, the shadow composite) isn't a concrete value.
    if (value.includes('var(')) continue
    for (const decl of expandToPhysical({ property, value })) decls.push(decl)
  }
  return decls
}

// Returns the contents of the first balanced `{ … }` block, or null if there is none.
function firstRuleBlock(cssText: string): string | null {
  const open = cssText.indexOf('{')
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < cssText.length; i++) {
    const ch = cssText[i]
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return cssText.slice(open + 1, i)
  }
  return null
}

function matchesPrefix(name: string, prefixes: Set<string>): boolean {
  const bare = name.startsWith('-') ? name.slice(1) : name
  for (const prefix of prefixes) {
    if (bare === prefix || bare.startsWith(`${prefix}-`)) return true
  }
  return false
}
