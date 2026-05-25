import { describe, it, expect } from 'vitest'
import { parseJsx } from '../src/ast/parse'
import { findOpeningElementByLoc } from '../src/ast/find'
import { tagName, stampLocOf } from './_jsx-helpers'

describe('parseJsx', () => {
  it('parses TSX with type annotations and JSX', () => {
    const ast = parseJsx('const C = (p: { n: number }) => <div>{p.n}</div>', 'C.tsx')
    expect(ast.type).toBe('File')
  })

  it('throws on a syntax error (callers treat this as unsupported)', () => {
    expect(() => parseJsx('const C = () => <div', 'C.tsx')).toThrow()
  })
})

describe('findOpeningElementByLoc', () => {
  it('matches a 1-based stamp column against the 0-based Babel column', () => {
    // `<button` begins at Babel column 10 (0-based) → the stamp records column 11 (1-based).
    const ast = parseJsx('const x = <button className="p-4" />', 'T.tsx')
    expect(tagName(findOpeningElementByLoc(ast, { line: 1, column: 11 }))).toBe('button')
  })

  it('does not match the raw Babel (0-based) column — the +1 is load-bearing', () => {
    const ast = parseJsx('const x = <button className="p-4" />', 'T.tsx')
    expect(findOpeningElementByLoc(ast, { line: 1, column: 10 })).toBeUndefined()
  })

  it('disambiguates sibling elements on the same line by column', () => {
    const code = 'const x = (<a><b /></a>)'
    const ast = parseJsx(code, 'T.tsx')
    expect(tagName(findOpeningElementByLoc(ast, stampLocOf(code, 'a')))).toBe('a')
    expect(tagName(findOpeningElementByLoc(ast, stampLocOf(code, 'b')))).toBe('b')
  })

  it('finds a nested element across multiple lines', () => {
    const code = [
      'function C() {',
      '  return (',
      '    <section>',
      '      <button className="p-4">go</button>',
      '    </section>',
      '  )',
      '}',
    ].join('\n')
    const ast = parseJsx(code, 'C.tsx')
    expect(tagName(findOpeningElementByLoc(ast, stampLocOf(code, 'button')))).toBe('button')
  })

  it('returns undefined when no element starts at the location', () => {
    const ast = parseJsx('const x = <div />', 'T.tsx')
    expect(findOpeningElementByLoc(ast, { line: 9, column: 1 })).toBeUndefined()
  })
})
