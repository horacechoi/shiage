import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'
import type { CssDecl, ThemeSource } from './types'
import { resolveValue } from './resolve-value'
import { NAMESPACE_PREFIXES } from '../mapper/groups'
import type { TailwindNamespace } from '../supported'

// Tailwind v3 has no exposed engine, so we resolve the user's config (jiti + their tailwindcss'
// resolveConfig) and derive class↔CSS structurally from the resolved theme object. Values are
// plain strings (hex colors, rem/px lengths, fontSize tuples) — no var()/calc() like v4.

type Scale = Record<string, unknown>
interface ResolvedTheme {
  spacing: Scale
  width: Scale
  height: Scale
  minWidth: Scale
  minHeight: Scale
  maxWidth: Scale
  maxHeight: Scale
  fontSize: Scale
  fontWeight: Scale
  lineHeight: Scale
  letterSpacing: Scale
  opacity: Scale
  borderRadius: Scale
  borderWidth: Scale
  colors: Record<string, unknown>
}

const TEXT_ALIGN = new Set(['left', 'center', 'right', 'justify', 'start', 'end'])
const BORDER_STYLE = new Set(['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'])

export interface CreateV3Options {
  rootFontSizePx?: number
}

export async function createV3ThemeSource(
  configPath: string,
  options: CreateV3Options = {},
): Promise<ThemeSource> {
  const configDir = path.dirname(configPath)
  const jiti = createJiti(pathToFileURL(configPath).href, { interopDefault: true })
  const userConfig = await jiti.import<object>(configPath, { default: true })

  const require = createRequire(path.join(configDir, '__shiage__.js'))
  const resolveConfig = require('tailwindcss/resolveConfig') as (config: object) => {
    theme: ResolvedTheme
  }
  const theme = resolveConfig(userConfig).theme
  const rootFontSizePx = options.rootFontSizePx ?? 16
  const colors = flattenColors(theme.colors)
  const resolveLen = (v: string): string =>
    resolveValue(v, { resolveToken: () => undefined, rootFontSizePx })

  function scaleValue(scale: Scale, key: string): string | undefined {
    const raw = scale[key]
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0] // fontSize: [size, {…}]
    return undefined
  }

  function classToDecls(classNames: string[]): CssDecl[][] {
    return classNames.map((name) => parseClass(name))
  }

  function parseClass(className: string): CssDecl[] {
    let sign = ''
    let cls = className
    if (cls.startsWith('-')) {
      sign = '-'
      cls = cls.slice(1)
    }
    for (const rule of RULES) {
      const key = matchRule(cls, rule.prefix)
      if (key === null) continue
      const decls = rule.build(key)
      if (decls) return sign ? decls.map((d) => ({ ...d, value: negate(d.value) })) : decls
      // A prefix matched but the key wasn't valid for it; keep trying other rules.
    }
    return []
  }

  // Build a single physical decl from a scale lookup, resolving the value to px.
  const one = (scale: Scale, key: string, property: string): CssDecl[] | null => {
    const v = scaleValue(scale, key)
    return v === undefined ? null : [{ property, value: resolveLen(v) }]
  }
  const many = (scale: Scale, key: string, properties: string[]): CssDecl[] | null => {
    const v = scaleValue(scale, key)
    if (v === undefined) return null
    const value = resolveLen(v)
    return properties.map((property) => ({ property, value }))
  }
  const color = (key: string, property: string): CssDecl[] | null => {
    const v = colors.get(key)
    return v === undefined ? null : [{ property, value: v }]
  }

  const PAD = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']
  const MAR = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']
  const RAD = [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ]
  const BW = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']

  interface Rule {
    prefix: string
    build: (key: string) => CssDecl[] | null
  }
  // Ordered most-specific first so `px-` is tried before `p-`, `border-x-` before `border-`, etc.
  const RULES: Rule[] = [
    { prefix: 'min-w', build: (k) => one(theme.minWidth, k, 'min-width') },
    { prefix: 'min-h', build: (k) => one(theme.minHeight, k, 'min-height') },
    { prefix: 'max-w', build: (k) => one(theme.maxWidth, k, 'max-width') },
    { prefix: 'max-h', build: (k) => one(theme.maxHeight, k, 'max-height') },
    { prefix: 'gap-x', build: (k) => one(theme.spacing, k, 'column-gap') },
    { prefix: 'gap-y', build: (k) => one(theme.spacing, k, 'row-gap') },
    { prefix: 'gap', build: (k) => many(theme.spacing, k, ['row-gap', 'column-gap']) },
    { prefix: 'px', build: (k) => many(theme.spacing, k, ['padding-left', 'padding-right']) },
    { prefix: 'py', build: (k) => many(theme.spacing, k, ['padding-top', 'padding-bottom']) },
    { prefix: 'pt', build: (k) => one(theme.spacing, k, 'padding-top') },
    { prefix: 'pr', build: (k) => one(theme.spacing, k, 'padding-right') },
    { prefix: 'pb', build: (k) => one(theme.spacing, k, 'padding-bottom') },
    { prefix: 'pl', build: (k) => one(theme.spacing, k, 'padding-left') },
    { prefix: 'p', build: (k) => many(theme.spacing, k, PAD) },
    { prefix: 'mx', build: (k) => many(theme.spacing, k, ['margin-left', 'margin-right']) },
    { prefix: 'my', build: (k) => many(theme.spacing, k, ['margin-top', 'margin-bottom']) },
    { prefix: 'mt', build: (k) => one(theme.spacing, k, 'margin-top') },
    { prefix: 'mr', build: (k) => one(theme.spacing, k, 'margin-right') },
    { prefix: 'mb', build: (k) => one(theme.spacing, k, 'margin-bottom') },
    { prefix: 'ml', build: (k) => one(theme.spacing, k, 'margin-left') },
    { prefix: 'm', build: (k) => many(theme.spacing, k, MAR) },
    { prefix: 'rounded-tl', build: (k) => one(theme.borderRadius, k, 'border-top-left-radius') },
    { prefix: 'rounded-tr', build: (k) => one(theme.borderRadius, k, 'border-top-right-radius') },
    {
      prefix: 'rounded-br',
      build: (k) => one(theme.borderRadius, k, 'border-bottom-right-radius'),
    },
    { prefix: 'rounded-bl', build: (k) => one(theme.borderRadius, k, 'border-bottom-left-radius') },
    {
      prefix: 'rounded-t',
      build: (k) => many(theme.borderRadius, k, [RAD[0]!, RAD[1]!]),
    },
    {
      prefix: 'rounded-r',
      build: (k) => many(theme.borderRadius, k, [RAD[1]!, RAD[2]!]),
    },
    {
      prefix: 'rounded-b',
      build: (k) => many(theme.borderRadius, k, [RAD[2]!, RAD[3]!]),
    },
    {
      prefix: 'rounded-l',
      build: (k) => many(theme.borderRadius, k, [RAD[3]!, RAD[0]!]),
    },
    { prefix: 'rounded', build: (k) => many(theme.borderRadius, k, RAD) },
    { prefix: 'border-x', build: (k) => many(theme.borderWidth, k, [BW[3]!, BW[1]!]) },
    { prefix: 'border-y', build: (k) => many(theme.borderWidth, k, [BW[0]!, BW[2]!]) },
    { prefix: 'border-t', build: (k) => one(theme.borderWidth, k, 'border-top-width') },
    { prefix: 'border-r', build: (k) => one(theme.borderWidth, k, 'border-right-width') },
    { prefix: 'border-b', build: (k) => one(theme.borderWidth, k, 'border-bottom-width') },
    { prefix: 'border-l', build: (k) => one(theme.borderWidth, k, 'border-left-width') },
    { prefix: 'border', build: (k) => borderAmbiguous(k) },
    { prefix: 'text', build: (k) => textAmbiguous(k) },
    { prefix: 'bg', build: (k) => color(k, 'background-color') },
    { prefix: 'font', build: (k) => one(theme.fontWeight, k, 'font-weight') },
    { prefix: 'leading', build: (k) => one(theme.lineHeight, k, 'line-height') },
    { prefix: 'tracking', build: (k) => one(theme.letterSpacing, k, 'letter-spacing') },
    { prefix: 'opacity', build: (k) => one(theme.opacity, k, 'opacity') },
    { prefix: 'w', build: (k) => one(theme.width, k, 'width') },
    { prefix: 'h', build: (k) => one(theme.height, k, 'height') },
  ]

  function borderAmbiguous(key: string): CssDecl[] | null {
    if (key === '') return many(theme.borderWidth, 'DEFAULT', BW)
    if (BORDER_STYLE.has(key)) return [{ property: 'border-style', value: key }]
    if (key in theme.borderWidth) return many(theme.borderWidth, key, BW)
    return color(key, 'border-color')
  }

  function textAmbiguous(key: string): CssDecl[] | null {
    if (TEXT_ALIGN.has(key)) return [{ property: 'text-align', value: key }]
    if (key in theme.fontSize) return one(theme.fontSize, key, 'font-size')
    return color(key, 'color')
  }

  function enumerateCandidates(namespaces: readonly TailwindNamespace[]): string[] {
    const out = new Set<string>()
    const add = (name: string): void => void out.add(name)
    const keys = (scale: Scale): string[] => Object.keys(scale)
    const suffix = (prefix: string, key: string): string =>
      key === 'DEFAULT' ? prefix : `${prefix}-${key}`

    for (const ns of namespaces) {
      switch (ns) {
        case 'spacing':
          for (const k of keys(theme.spacing)) {
            for (const p of ['pt', 'pr', 'pb', 'pl', 'gap-x', 'gap-y']) add(suffix(p, k))
            for (const p of ['mt', 'mr', 'mb', 'ml']) {
              add(suffix(p, k))
              if (scaleValue(theme.spacing, k) !== '0px') add(`-${suffix(p, k)}`)
            }
          }
          break
        case 'width':
        case 'height':
        case 'minWidth':
        case 'minHeight':
        case 'maxWidth':
        case 'maxHeight':
          for (const k of keys(theme[ns])) add(suffix(NAMESPACE_PREFIXES[ns][0]!, k))
          break
        case 'fontSize':
          for (const k of keys(theme.fontSize)) add(`text-${k}`)
          break
        case 'fontWeight':
          for (const k of keys(theme.fontWeight)) add(`font-${k}`)
          break
        case 'lineHeight':
          for (const k of keys(theme.lineHeight)) add(`leading-${k}`)
          break
        case 'letterSpacing':
          for (const k of keys(theme.letterSpacing)) add(`tracking-${k}`)
          break
        case 'opacity':
          for (const k of keys(theme.opacity)) add(`opacity-${k}`)
          break
        case 'borderWidth':
          for (const k of keys(theme.borderWidth)) {
            for (const p of ['border-t', 'border-r', 'border-b', 'border-l']) add(suffix(p, k))
          }
          break
        case 'borderRadius':
          for (const k of keys(theme.borderRadius)) {
            for (const p of ['rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl'])
              add(suffix(p, k))
          }
          break
        case 'borderStyle':
          for (const s of ['solid', 'dashed', 'dotted', 'none']) add(`border-${s}`)
          break
        case 'textAlign':
          for (const a of ['left', 'center', 'right', 'justify']) add(`text-${a}`)
          break
        case 'colors':
          for (const c of colors.keys()) for (const p of ['text', 'bg', 'border']) add(`${p}-${c}`)
          break
        case 'boxShadow':
          break
      }
    }
    return [...out]
  }

  return {
    version: 3,
    sourcePath: configPath,
    classToDecls,
    enumerateCandidates,
    // v3 has no canonicalizer; the exact-match path already covers it.
    canonicalize: (classNames) => classNames,
    resolveToken: () => undefined,
  }
}

// `cls` must equal `prefix` (returns '') or start with `prefix-` (returns the rest). Else null.
function matchRule(cls: string, prefix: string): string | null {
  if (cls === prefix) return ''
  return cls.startsWith(`${prefix}-`) ? cls.slice(prefix.length + 1) : null
}

function negate(value: string): string {
  if (!/^-?[\d.]/.test(value)) return value // only negate numeric lengths
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}

function flattenColors(colors: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(colors)) {
    const name = key === 'DEFAULT' ? prefix.replace(/-$/, '') : `${prefix}${key}`
    if (typeof value === 'string') {
      if (name) out.set(name, value)
    } else if (value && typeof value === 'object') {
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v2 === 'string') {
          out.set(k2 === 'DEFAULT' ? name : `${name}-${k2}`, v2)
        }
      }
    }
  }
  return out
}
