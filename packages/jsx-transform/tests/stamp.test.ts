import { describe, it, expect } from 'vitest'
import { transformSync } from '@babel/core'
import plugin, { STAMP_ATTRIBUTE, type ShiageStampOptions } from '../src/index'

/** Run the stamper over `code` and return the generated output (JSX retained — no JSX transform). */
function stamp(
  code: string,
  options: ShiageStampOptions = { projectRoot: '/proj' },
  filename = '/proj/src/Card.tsx',
): string {
  const result = transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [[plugin, options]],
  })
  if (!result?.code) throw new Error('transform produced no output')
  return result.code
}

const stampRe = new RegExp(`${STAMP_ATTRIBUTE}=(["'])(.*?)\\1`, 'g')

/** The stamped location strings, in source order. */
function stampValues(code: string): string[] {
  return [...code.matchAll(stampRe)].map((m) => m[2]!)
}

describe('shiageStampPlugin', () => {
  it('stamps the exact relPath:line:col the runtime expects (the Accept criterion)', () => {
    // Put <button> on line 42 indented 8 spaces → Babel column 8 (0-based) → stamped column 9.
    const code = '\n'.repeat(41) + '        <button>go</button>'
    expect(stampValues(stamp(code))).toEqual(['src/Card.tsx:42:9'])
  })

  it('uses a 1-based column (Babel 0-based + 1) and 1-based line', () => {
    expect(stampValues(stamp('<a />', { projectRoot: '/proj' }, '/proj/x.tsx'))).toEqual([
      'x.tsx:1:1',
    ])
  })

  it('makes the path relative to projectRoot with posix separators', () => {
    const out = stamp('<div>x</div>', { projectRoot: '/proj' }, '/proj/app/components/Card.tsx')
    expect(stampValues(out)).toEqual(['app/components/Card.tsx:1:1'])
  })

  it('falls back to Babel project root when projectRoot is omitted', () => {
    const out = stamp('<div />', {}, '/proj/src/a.tsx')
    // Babel resolves `root` to the cwd by default; the path stays relative, not absolute.
    expect(stampValues(out)[0]).not.toMatch(/^\//)
  })

  it('gives each element on a line its own column', () => {
    expect(
      stampValues(stamp('<div><a /><b /></div>', { projectRoot: '/proj' }, '/proj/x.tsx')),
    ).toEqual(['x.tsx:1:1', 'x.tsx:1:6', 'x.tsx:1:11'])
  })

  it('stamps custom (hyphenated, lowercase) elements', () => {
    expect(
      stampValues(stamp('<my-widget />', { projectRoot: '/proj' }, '/proj/x.tsx')),
    ).toHaveLength(1)
  })

  it('skips uppercase component elements', () => {
    expect(stampValues(stamp('<Card />'))).toEqual([])
  })

  it('skips member-expression elements like <Foo.Bar>', () => {
    expect(stampValues(stamp('<Foo.Bar />'))).toEqual([])
  })

  it('stamps only the host element in a mixed tree', () => {
    expect(stampValues(stamp('<Card><span /></Card>'))).toHaveLength(1)
  })

  it('does not re-stamp an element that already has the attribute', () => {
    const out = stamp(`<button ${STAMP_ATTRIBUTE}="orig:1:1">y</button>`)
    expect(stampValues(out)).toEqual(['orig:1:1'])
  })

  it('is a no-op when disabled (production builds leave no stamps)', () => {
    expect(stampValues(stamp('<button />', { enabled: false, projectRoot: '/proj' }))).toEqual([])
  })

  it('stamps nested elements with their own line numbers', () => {
    const code = ['<section>', '  <button>go</button>', '</section>'].join('\n')
    expect(stampValues(stamp(code, { projectRoot: '/proj' }, '/proj/x.tsx'))).toEqual([
      'x.tsx:1:1',
      'x.tsx:2:3',
    ])
  })
})
