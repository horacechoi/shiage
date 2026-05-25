import type { ThemeSource } from './types'
import {
  SUPPORTED_PROPERTIES,
  SUPPORTED_NAMESPACES,
  isSupportedProperty,
  type PropertyKind,
} from '../supported'
import { parseColor, rgbToKey, type Rgb } from '../color'

export interface ColorEntry {
  rgb: Rgb
  className: string
}

export interface ColorTable {
  /** rgb key (`rgb(r, g, b)`) → class, for exact matches. */
  exact: Map<string, string>
  /** all theme colors for this property, for nearest-match snapping. */
  entries: ColorEntry[]
}

export interface ReverseLookup {
  /** Non-color longhand property → (normalized value → single-purpose canonical class). */
  byProperty: Map<string, Map<string, string>>
  /** Color property (`color`, `background-color`, `border-color`) → its color table. */
  byColorProperty: Map<string, ColorTable>
  rootFontSizePx: number
}

// Properties a single-purpose utility may set *in addition to* its primary one. Tailwind's
// font-size utilities (text-base, text-lg, …) also set a default line-height; we treat that as a
// companion so the class still counts as the canonical font-size utility.
const COMPANIONS: Record<string, ReadonlySet<string>> = {
  'font-size': new Set(['line-height']),
}
const NO_COMPANIONS: ReadonlySet<string> = new Set()

/**
 * Normalize a value to a stable lookup key, by property kind. Applied identically when building
 * the table (on resolved theme values) and when querying it (on computed styles), so the two line
 * up: lengths round to 0.5px, opacity `%` becomes a decimal, keywords lowercase.
 */
export function normalizeValueForKind(kind: PropertyKind, value: string): string {
  const v = value.trim()
  if (kind === 'length') {
    const m = /^(-?[\d.]+)px$/.exec(v)
    if (!m) return v.toLowerCase()
    return `${Math.round(Number.parseFloat(m[1]!) * 2) / 2}px`
  }
  if (kind === 'number') {
    if (v.endsWith('%')) return String(Number.parseFloat(v) / 100)
    const n = Number.parseFloat(v)
    return Number.isNaN(n) ? v : String(n)
  }
  if (kind === 'keyword') return v.toLowerCase()
  return v
}

/**
 * Build the reverse lookup by enumerating the project's v1-namespace utilities, asking the engine
 * what CSS each generates, and inverting. Only single-purpose utilities (one supported property,
 * plus allowed companions) feed the table; shorthands like `p-4` are recombined by the mapper.
 */
export function buildReverseLookup(
  source: ThemeSource,
  opts: { rootFontSizePx?: number } = {},
): ReverseLookup {
  const rootFontSizePx = opts.rootFontSizePx ?? 16
  const byProperty = new Map<string, Map<string, string>>()
  const byColorProperty = new Map<string, ColorTable>()

  const candidates = source.enumerateCandidates(SUPPORTED_NAMESPACES)
  const declsPerClass = source.classToDecls(candidates)

  for (let i = 0; i < candidates.length; i++) {
    const className = candidates[i]!
    const decls = declsPerClass[i]!
    if (decls.length === 0) continue
    const allProps = new Set(decls.map((d) => d.property))

    for (const property of primaryProperties(allProps)) {
      const value = decls.find((d) => d.property === property)?.value
      if (value === undefined) continue
      const meta = SUPPORTED_PROPERTIES[property as keyof typeof SUPPORTED_PROPERTIES]
      if (meta.kind === 'color') addColor(byColorProperty, property, value, className)
      else if (meta.kind !== 'shadow') addValue(byProperty, property, meta.kind, value, className)
    }
  }

  return { byProperty, byColorProperty, rootFontSizePx }
}

// The supported properties for which this class is a single-purpose utility (its only non-companion
// effect). A class can qualify for at most its primary property.
function primaryProperties(allProps: Set<string>): string[] {
  const out: string[] = []
  for (const property of allProps) {
    if (!isSupportedProperty(property)) continue
    const companions = COMPANIONS[property] ?? NO_COMPANIONS
    const pure = [...allProps].every((q) => q === property || companions.has(q))
    if (pure) out.push(property)
  }
  return out
}

function addColor(
  byColorProperty: Map<string, ColorTable>,
  property: string,
  value: string,
  className: string,
): void {
  const rgb = parseColor(value)
  if (!rgb) return
  const table: ColorTable = byColorProperty.get(property) ?? { exact: new Map(), entries: [] }
  const key = rgbToKey(rgb)
  const existing = table.exact.get(key)
  if (existing === undefined || className.length < existing.length) table.exact.set(key, className)
  table.entries.push({ rgb, className })
  byColorProperty.set(property, table)
}

function addValue(
  byProperty: Map<string, Map<string, string>>,
  property: string,
  kind: PropertyKind,
  value: string,
  className: string,
): void {
  const norm = normalizeValueForKind(kind, value)
  const map = byProperty.get(property) ?? new Map<string, string>()
  const existing = map.get(norm)
  // On collision prefer the shorter (more canonical) class name.
  if (existing === undefined || className.length < existing.length) map.set(norm, className)
  byProperty.set(property, map)
}
