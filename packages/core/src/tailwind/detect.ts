import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ThemeSource } from './types'
import { createV4ThemeSource } from './v4'
import { createV3ThemeSource } from './v3'

export interface DetectOptions {
  rootFontSizePx?: number
  /** Force the Tailwind major version, bypassing auto-detection. */
  version?: 3 | 4
  /** Explicit v4 CSS entry (the file importing "tailwindcss"), relative to projectRoot or absolute. */
  cssEntry?: string
  /** Explicit v3 config path, relative to projectRoot or absolute. */
  configPath?: string
}

// Common locations for a v4 CSS entry. We confirm by content, not just the path.
const V4_CSS_CANDIDATES = [
  'src/index.css',
  'src/app.css',
  'src/main.css',
  'src/styles.css',
  'src/globals.css',
  'src/styles/globals.css',
  'src/styles/index.css',
  'src/app/globals.css',
  'app/globals.css',
  'styles/globals.css',
  'index.css',
  'globals.css',
]
const V3_CONFIG_CANDIDATES = [
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
]
const TAILWIND_IMPORT = /@import\s+["']tailwindcss["']|@tailwind\s+/

/**
 * Detect a project's Tailwind setup and build the matching ThemeSource. Prefers the installed
 * `tailwindcss` major version (so a stale v3 config next to a v4 install picks v4), then locates
 * the entry. Explicit overrides in `options` skip detection.
 */
export async function detectThemeSource(
  projectRoot: string,
  options: DetectOptions = {},
): Promise<ThemeSource> {
  const sub = { rootFontSizePx: options.rootFontSizePx }

  if (options.configPath) {
    return createV3ThemeSource(path.resolve(projectRoot, options.configPath), sub)
  }
  if (options.cssEntry) {
    return createV4ThemeSource(path.resolve(projectRoot, options.cssEntry), sub)
  }

  const major = options.version ?? installedTailwindMajor(projectRoot)
  if (major === 4) {
    const css = findV4Css(projectRoot)
    if (css) return createV4ThemeSource(css, sub)
    throw new Error(
      `[shiage] Detected Tailwind v4 in ${projectRoot} but found no CSS entry importing "tailwindcss". ` +
        `Pass shiage({ tailwind: { cssEntry: 'src/app.css' } }).`,
    )
  }
  if (major === 3) {
    const config = findV3Config(projectRoot)
    if (config) return createV3ThemeSource(config, sub)
    throw new Error(
      `[shiage] Detected Tailwind v3 in ${projectRoot} but found no tailwind.config. ` +
        `Pass shiage({ tailwind: { configPath: 'tailwind.config.js' } }).`,
    )
  }

  // No installed-version signal: infer from files (a config → v3, a CSS entry → v4).
  const config = findV3Config(projectRoot)
  if (config) return createV3ThemeSource(config, sub)
  const css = findV4Css(projectRoot)
  if (css) return createV4ThemeSource(css, sub)
  throw new Error(
    `[shiage] Could not detect Tailwind in ${projectRoot}. ` +
      `Pass shiage({ tailwind: { version, cssEntry | configPath } }).`,
  )
}

function installedTailwindMajor(projectRoot: string): number | undefined {
  try {
    const require = createRequire(path.join(projectRoot, '__shiage__.js'))
    const pkgPath = require.resolve('tailwindcss/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    const match = /^(\d+)\./.exec(pkg.version ?? '')
    return match ? Number(match[1]) : undefined
  } catch {
    return undefined
  }
}

function findV4Css(projectRoot: string): string | undefined {
  for (const rel of V4_CSS_CANDIDATES) {
    const file = path.join(projectRoot, rel)
    if (existsSync(file) && TAILWIND_IMPORT.test(safeRead(file))) return file
  }
  return undefined
}

function findV3Config(projectRoot: string): string | undefined {
  for (const rel of V3_CONFIG_CANDIDATES) {
    const file = path.join(projectRoot, rel)
    if (existsSync(file)) return file
  }
  return undefined
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
