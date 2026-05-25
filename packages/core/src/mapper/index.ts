import { SUPPORTED_PROPERTIES, isSupportedProperty, type PhysicalGroup } from '../supported'
import { PROPERTY_PREFIX, GROUP_TILINGS, type GroupTiling } from './groups'
import { normalizeValueForKind, type ReverseLookup } from '../tailwind/reverse-lookup'
import { parseColor, rgbToKey, colorDistance, type Rgb } from '../color'
import type { CssDecl, ThemeSource } from '../tailwind/types'
import type { PropertyChange } from '../protocol'

// PropertyChange is the wire shape (defined once in ../protocol); re-exported here since the mapper
// is its primary consumer and the public API has always surfaced it from core's mapper entry.
export type { PropertyChange }

export type ClassMatch =
  | { kind: 'canonical'; className: string }
  | { kind: 'arbitrary'; className: string }
  | { kind: 'snapped'; className: string; from: string } // nearest theme color within threshold
  | { kind: 'unsupported'; reason: string }

/** Max rgb Euclidean distance for snapping a computed color to a near theme color. */
const COLOR_SNAP_THRESHOLD = 5

export interface FindOptions {
  /** Snap a computed color to a very close theme color (default true). */
  colorSnap?: boolean
}

/**
 * Find the Tailwind class that sets `property` to `value` on the user's theme: a canonical class
 * when one exists, else an arbitrary-value class (`pl-[23px]`, `text-[#0c2238]`), else unsupported.
 * This is the per-property primitive; recombining multiple changed sides into a shorthand is the
 * job of mapChangesToClassEdits.
 */
export function findClassForProperty(
  property: string,
  value: string,
  lookup: ReverseLookup,
  options: FindOptions = {},
): ClassMatch {
  if (!isSupportedProperty(property)) {
    return { kind: 'unsupported', reason: `${property} is not supported in v1` }
  }
  const meta = SUPPORTED_PROPERTIES[property]
  const prefix = PROPERTY_PREFIX[property]

  if (meta.kind === 'color') {
    return matchColor(property, value, lookup, prefix, options.colorSnap ?? true)
  }

  const norm = normalizeValueForKind(meta.kind, value)
  const canonical = lookup.byProperty.get(property)?.get(norm)
  if (canonical) return { kind: 'canonical', className: canonical }

  // Keywords (text-align, border-style) and shadows have no arbitrary form in v1.
  if (meta.kind === 'keyword' || meta.kind === 'shadow' || !prefix) {
    return { kind: 'unsupported', reason: `no Tailwind class for ${property}: ${value}` }
  }
  return { kind: 'arbitrary', className: `${prefix}-[${norm}]` }
}

function matchColor(
  property: string,
  value: string,
  lookup: ReverseLookup,
  prefix: string | undefined,
  snap: boolean,
): ClassMatch {
  const rgb = parseColor(value)
  if (!rgb) return { kind: 'unsupported', reason: `unparseable color: ${value}` }

  const table = lookup.byColorProperty.get(property)
  if (table) {
    const exact = table.exact.get(rgbToKey(rgb))
    if (exact) return { kind: 'canonical', className: exact }
    if (snap) {
      let best: { className: string; rgb: Rgb } | undefined
      let bestDistance = Infinity
      for (const entry of table.entries) {
        const d = colorDistance(rgb, entry.rgb)
        if (d < bestDistance) {
          bestDistance = d
          best = entry
        }
      }
      if (best && bestDistance <= COLOR_SNAP_THRESHOLD) {
        return { kind: 'snapped', className: best.className, from: rgbToKey(rgb) }
      }
    }
  }
  if (!prefix) return { kind: 'unsupported', reason: `no prefix for ${property}` }
  return { kind: 'arbitrary', className: `${prefix}-[${toArbitraryColor(rgb)}]` }
}

function toArbitraryColor(rgb: Rgb): string {
  if (rgb.a < 1) return `rgba(${rgb.r},${rgb.g},${rgb.b},${rgb.a})`
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`
}

/**
 * Of the given class tokens, those that set `property` (after shorthand/logical expansion).
 * Used to find existing tokens that conflict with an edit. E.g. `['p-4', 'text-red-500']` for
 * `padding-left` → `['p-4']`, since `p-4` sets all four padding sides.
 */
export function classProducingProperty(
  classTokens: string[],
  property: string,
  source: ThemeSource,
): string[] {
  const declsPerToken = source.classToDecls(classTokens)
  const out: string[] = []
  for (let i = 0; i < classTokens.length; i++) {
    if (declsPerToken[i]!.some((decl) => decl.property === property)) out.push(classTokens[i]!)
  }
  return out
}

export interface ClassEdits {
  /** Tailwind classes to add. */
  add: string[]
  /** Existing class tokens to remove (superseded or conflicting). */
  remove: string[]
  /** Human-readable notes (e.g. color snapping) to surface in the diff panel. */
  warnings: string[]
  /** Properties that couldn't be mapped (shown to the user as "not supported in v1"). */
  unsupported: string[]
}

/**
 * Turn a batch of computed-style changes into class edits against the current className.
 *
 * Singletons (width, color, …) map directly. Grouped properties (padding/margin/border-width/
 * border-radius/gap) are recombined: sides changed to the same value collapse to the smallest
 * covering class (4 sides → `p-6`, an axis → `px-6`, one side → `pl-6`). We rely on Tailwind's
 * cascade ordering (directional classes win over shorthands) instead of decomposing existing
 * shorthands, so a single-side change to an element with `p-4` just adds `pl-6` and keeps `p-4`.
 * Existing tokens fully superseded by the changed sides are removed.
 */
export function mapChangesToClassEdits(
  changes: PropertyChange[],
  currentClassName: string,
  lookup: ReverseLookup,
  source: ThemeSource,
): ClassEdits {
  const tokens = currentClassName.split(/\s+/).filter(Boolean)
  const declsByToken = new Map<string, CssDecl[]>()
  const allDecls = source.classToDecls(tokens)
  tokens.forEach((token, i) => declsByToken.set(token, allDecls[i]!))

  const add: string[] = []
  const remove = new Set<string>()
  const warnings: string[] = []
  const unsupported: string[] = []

  const grouped = new Map<PhysicalGroup, PropertyChange[]>()
  const singletons: PropertyChange[] = []
  for (const change of changes) {
    if (!isSupportedProperty(change.property)) {
      unsupported.push(change.property)
      continue
    }
    const group = SUPPORTED_PROPERTIES[change.property].group
    if (group) {
      const list = grouped.get(group) ?? []
      list.push(change)
      grouped.set(group, list)
    } else {
      singletons.push(change)
    }
  }

  for (const change of singletons) {
    const match = findClassForProperty(change.property, change.newValue, lookup)
    if (match.kind === 'unsupported') {
      unsupported.push(change.property)
      continue
    }
    add.push(match.className)
    if (match.kind === 'snapped') warnings.push(`Matched ${match.from} to ${match.className}`)
    for (const token of tokens) {
      if (declsByToken.get(token)!.some((d) => d.property === change.property)) remove.add(token)
    }
  }

  for (const [group, groupChanges] of grouped) {
    const tiling = GROUP_TILINGS[group]
    const changedSides = new Set<string>()
    // sign+suffix → the sides changed to that exact value (so they can collapse together).
    const byValue = new Map<string, { sign: string; suffix: string; sides: Set<string> }>()

    for (const change of groupChanges) {
      const side = tiling.longhandToSide[change.property]
      if (side === undefined) continue
      const match = findClassForProperty(change.property, change.newValue, lookup)
      if (match.kind === 'unsupported') {
        unsupported.push(change.property)
        continue
      }
      if (match.kind === 'snapped') warnings.push(`Matched ${match.from} to ${match.className}`)
      const parts = extractSuffix(match.className, change.property)
      if (!parts) {
        unsupported.push(change.property)
        continue
      }
      changedSides.add(side)
      const key = `${parts.sign}${parts.suffix}`
      const bucket = byValue.get(key) ?? {
        sign: parts.sign,
        suffix: parts.suffix,
        sides: new Set(),
      }
      bucket.sides.add(side)
      byValue.set(key, bucket)
    }

    for (const bucket of byValue.values()) {
      for (const prefix of tileSides(bucket.sides, tiling)) {
        add.push(`${bucket.sign}${prefix}-${bucket.suffix}`)
      }
    }

    if (changedSides.size > 0) {
      for (const token of tokens) {
        const sides = sidesForToken(declsByToken.get(token)!, tiling)
        if (sides.length > 0 && sides.every((s) => changedSides.has(s))) remove.add(token)
      }
    }
  }

  // Never both add and remove the same token (e.g. re-applying an unchanged class).
  const addSet = new Set(add)
  for (const token of addSet) remove.delete(token)

  return { add: [...addSet], remove: [...remove], warnings, unsupported }
}

// Splits a single-side class into its optional negative sign and value suffix, e.g.
// `pl-6` → { sign: '', suffix: '6' }, `-ml-6` → { sign: '-', suffix: '6' }, `pl-[23px]` → '[23px]'.
function extractSuffix(
  className: string,
  longhand: string,
): { sign: string; suffix: string } | null {
  const prefix = PROPERTY_PREFIX[longhand]
  if (!prefix) return null
  let sign = ''
  let name = className
  if (name.startsWith('-')) {
    sign = '-'
    name = name.slice(1)
  }
  const head = `${prefix}-`
  if (!name.startsWith(head)) return null
  return { sign, suffix: name.slice(head.length) }
}

// Greedily covers a set of sides with the largest combos first (shorthand → axis → single side).
function tileSides(sides: Set<string>, tiling: GroupTiling): string[] {
  const remaining = new Set(sides)
  const chosen: string[] = []
  for (const combo of tiling.combos) {
    if (combo.sides.length > 0 && combo.sides.every((s) => remaining.has(s))) {
      for (const s of combo.sides) remaining.delete(s)
      chosen.push(combo.prefix)
      if (remaining.size === 0) break
    }
  }
  return chosen
}

function sidesForToken(decls: CssDecl[], tiling: GroupTiling): string[] {
  const sides = new Set<string>()
  for (const decl of decls) {
    const side = tiling.longhandToSide[decl.property]
    if (side !== undefined) sides.add(side)
  }
  return [...sides]
}
