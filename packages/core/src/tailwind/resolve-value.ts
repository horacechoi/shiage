// Resolves a Tailwind-generated CSS value to a concrete, normalized form so it can be compared
// against getComputedStyle output. Handles var() indirection, simple calc() arithmetic, and
// rem/em→px conversion. This layer is generic; property-kind-specific normalization
// (colors→rgb, opacity %→decimal) happens downstream in the reverse-lookup builder.
//
// Verified against the real Tailwind v4 engine output (see the tailwind-v4-designsystem-api note):
// `p-4` → `padding: calc(var(--spacing) * 4)`, `--spacing` → `0.25rem`, etc.

export interface ResolveValueOptions {
  /** Resolves a CSS custom property to its value, e.g. `'--spacing'` → `'0.25rem'`. */
  resolveToken: (token: string) => string | undefined
  /** Root font size in px, used for rem→px (and em, approximated). Defaults to 16. */
  rootFontSizePx?: number
}

// A single var() reference with an optional (non-nested) fallback.
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/

/**
 * Resolve `raw` to a concrete value: substitute `var()`s, evaluate a `calc()`, convert standalone
 * rem/em to px. Anything not understood (colors, keywords, unresolved vars) is returned trimmed
 * and unchanged, so callers can normalize it themselves.
 */
export function resolveValue(raw: string, opts: ResolveValueOptions): string {
  const rootPx = opts.rootFontSizePx ?? 16
  let value = raw.trim()
  value = resolveVars(value, opts.resolveToken)
  value = evaluateCalc(value, rootPx)
  value = normalizeStandaloneLength(value, rootPx)
  return value.trim()
}

function resolveVars(input: string, resolve: (token: string) => string | undefined): string {
  let out = input
  // Iterate (rather than recurse) so a resolved value containing another var() is handled too.
  for (let i = 0; i < 16; i++) {
    const m = VAR_RE.exec(out)
    if (!m) break
    const token = m[1]!
    const fallback = m[2]
    const resolved = resolve(token) ?? (fallback !== undefined ? fallback.trim() : undefined)
    if (resolved === undefined) break // unresolved and no fallback: leave the var() in place
    out = out.slice(0, m.index) + resolved + out.slice(m.index + m[0].length)
  }
  return out
}

function evaluateCalc(input: string, rootPx: number): string {
  const m = /^calc\((.*)\)$/s.exec(input.trim())
  if (!m) return input
  return evalExpression(m[1]!.trim(), rootPx) ?? input
}

interface Measure {
  n: number
  kind: 'scalar' | 'px' | 'percent'
}

function parseMeasure(token: string, rootPx: number): Measure | null {
  const m = /^(-?[\d.]+)(px|rem|em|%)?$/.exec(token.trim())
  if (!m) return null
  const n = Number.parseFloat(m[1]!)
  const unit = m[2]
  if (unit === undefined) return { n, kind: 'scalar' }
  if (unit === 'px') return { n, kind: 'px' }
  if (unit === 'rem' || unit === 'em') return { n: n * rootPx, kind: 'px' }
  return { n, kind: 'percent' }
}

// Evaluates a single binary `calc()` expression (the only shape Tailwind v1 utilities emit),
// e.g. `0.25rem * 4`. Returns null when the expression isn't a shape we can reduce, so the
// caller falls back to the original string rather than emitting something wrong.
function evalExpression(expr: string, rootPx: number): string | null {
  const m = /^(\S+)\s*([*/+-])\s*(\S+)$/.exec(expr)
  if (!m) {
    const single = parseMeasure(expr, rootPx)
    return single ? formatMeasure(single) : null
  }
  const left = parseMeasure(m[1]!, rootPx)
  const right = parseMeasure(m[3]!, rootPx)
  if (!left || !right) return null

  let n: number
  let kind: Measure['kind']
  switch (m[2]) {
    case '*':
      if (left.kind === 'scalar') ({ n, kind } = { n: left.n * right.n, kind: right.kind })
      else if (right.kind === 'scalar') ({ n, kind } = { n: left.n * right.n, kind: left.kind })
      else return null
      break
    case '/':
      if (right.kind !== 'scalar' || right.n === 0) return null
      n = left.n / right.n
      kind = left.kind
      break
    case '+':
    case '-':
      if (left.kind !== right.kind) return null
      n = m[2] === '+' ? left.n + right.n : left.n - right.n
      kind = left.kind
      break
    default:
      return null
  }
  return formatMeasure({ n, kind })
}

function normalizeStandaloneLength(value: string, rootPx: number): string {
  const m = /^(-?[\d.]+)(rem|em)$/.exec(value.trim())
  if (!m) return value
  return formatPx(Number.parseFloat(m[1]!) * rootPx)
}

function formatMeasure(m: Measure): string {
  if (m.kind === 'scalar') return String(round(m.n))
  if (m.kind === 'percent') return `${round(m.n)}%`
  return formatPx(m.n)
}

function formatPx(px: number): string {
  return `${round(px)}px`
}

function round(n: number): number {
  // Trim float noise (e.g. 23.999999 → 24) while preserving sub-px precision.
  return Number(n.toFixed(4))
}
