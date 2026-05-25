// CSS color parsing and conversion to sRGB. Theme colors come in as oklch (Tailwind v4 default),
// hex, rgb, or hsl; getComputedStyle always reports rgb/rgba. To match a theme color against a
// computed value we convert both to sRGB. The oklch→sRGB path uses the CSS Color 4 / Björn
// Ottosson conversion, which is what the browser computes, so values line up within rounding.

export interface Rgb {
  /** 0–255 integer. */
  r: number
  /** 0–255 integer. */
  g: number
  /** 0–255 integer. */
  b: number
  /** 0–1. */
  a: number
}

/** Parse any supported CSS color string to sRGB, or null if it isn't one we handle. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (s.startsWith('#')) return parseHex(s)
  if (s.startsWith('rgb')) return parseFunc(s, rgbFromParts)
  if (s.startsWith('oklch')) return parseFunc(s, oklchFromParts)
  if (s.startsWith('hsl')) return parseFunc(s, hslFromParts)
  return null
}

/** Canonical key for the reverse lookup: `rgb(r, g, b)` when opaque, else `rgba(r, g, b, a)`. */
export function rgbToKey(c: Rgb): string {
  return c.a >= 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${round(c.a, 3)})`
}

/** Euclidean distance in sRGB (alpha ignored); used for nearest-theme-color snapping. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

function parseHex(s: string): Rgb | null {
  const h = s.slice(1)
  if (!/^[0-9a-f]+$/.test(h)) return null
  const dbl = (x: string): number => Number.parseInt(x + x, 16)
  const pair = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16)
  if (h.length === 3) return { r: dbl(h[0]!), g: dbl(h[1]!), b: dbl(h[2]!), a: 1 }
  if (h.length === 4) return { r: dbl(h[0]!), g: dbl(h[1]!), b: dbl(h[2]!), a: dbl(h[3]!) / 255 }
  if (h.length === 6) return { r: pair(0), g: pair(2), b: pair(4), a: 1 }
  if (h.length === 8) return { r: pair(0), g: pair(2), b: pair(4), a: pair(6) / 255 }
  return null
}

// Splits the inside of `fn(...)` on commas, spaces, and the `/` alpha separator.
function parseFunc(s: string, build: (parts: string[]) => Rgb | null): Rgb | null {
  const open = s.indexOf('(')
  const close = s.lastIndexOf(')')
  if (open < 0 || close < 0) return null
  const parts = s
    .slice(open + 1, close)
    .split(/[\s,/]+/)
    .filter(Boolean)
  return parts.length >= 3 ? build(parts) : null
}

function num(p: string): number {
  return Number.parseFloat(p)
}

function parseAlpha(p: string | undefined): number {
  if (p === undefined) return 1
  return p.endsWith('%') ? num(p) / 100 : num(p)
}

function rgbFromParts(parts: string[]): Rgb | null {
  const ch = (p: string): number => (p.endsWith('%') ? (num(p) / 100) * 255 : num(p))
  const r = ch(parts[0]!)
  const g = ch(parts[1]!)
  const b = ch(parts[2]!)
  if ([r, g, b].some(Number.isNaN)) return null
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: parseAlpha(parts[3]) }
}

function oklchFromParts(parts: string[]): Rgb | null {
  const L = parts[0]!.endsWith('%') ? num(parts[0]!) / 100 : num(parts[0]!)
  const C = num(parts[1]!)
  const H = num(parts[2]!) // degrees
  if ([L, C, H].some(Number.isNaN)) return null
  return oklchToRgb(L, C, H, parseAlpha(parts[3]))
}

function hslFromParts(parts: string[]): Rgb | null {
  const h = num(parts[0]!)
  const sat = num(parts[1]!) / 100
  const li = num(parts[2]!) / 100
  if ([h, sat, li].some(Number.isNaN)) return null
  return hslToRgb(h, sat, li, parseAlpha(parts[3]))
}

function oklchToRgb(L: number, C: number, hDeg: number, alpha: number): Rgb {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  // oklab → LMS (cube of these) → linear sRGB.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return {
    r: clampByte(gamma(lr) * 255),
    g: clampByte(gamma(lg) * 255),
    b: clampByte(gamma(lb) * 255),
    a: alpha,
  }
}

// Linear sRGB → gamma-encoded sRGB, clamped to [0, 1].
function gamma(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.min(1, Math.max(0, v))
}

function hslToRgb(hDeg: number, s: number, l: number, alpha: number): Rgb {
  const h = ((hDeg % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return {
    r: clampByte((r + m) * 255),
    g: clampByte((g + m) * 255),
    b: clampByte((b + m) * 255),
    a: alpha,
  }
}

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)))
}

function round(n: number, digits: number): number {
  return Number(n.toFixed(digits))
}
