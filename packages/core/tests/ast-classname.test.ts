import { describe, it, expect } from 'vitest'
import { analyzeClassName, type ClassNameAnalysis } from '../src/ast/classname'
import { findElement } from './_jsx-helpers'

const analyze = (code: string, tag = 'div'): ClassNameAnalysis =>
  analyzeClassName(findElement(code, tag).el)

describe('analyzeClassName', () => {
  it('treats a string-literal className as one fully-editable span', () => {
    const a = analyze('const C = () => <div className="p-4 text-red-500" />')
    expect(a).toMatchObject({ kind: 'spans', partial: false })
    if (a.kind === 'spans') expect(a.spans.map((s) => s.text)).toEqual(['p-4 text-red-500'])
  })

  it('treats an expression-wrapped string literal the same', () => {
    const a = analyze("const C = () => <div className={'p-4'} />")
    expect(a).toMatchObject({ kind: 'spans', partial: false })
    if (a.kind === 'spans') expect(a.spans.map((s) => s.text)).toEqual(['p-4'])
  })

  it('treats an expression-less template literal as one editable span', () => {
    const a = analyze('const C = () => <div className={`p-4 flex`} />')
    expect(a).toMatchObject({ kind: 'spans', partial: false })
    if (a.kind === 'spans') expect(a.spans.map((s) => s.text)).toEqual(['p-4 flex'])
  })

  it('classifies a template literal with interpolation as a template (edit static quasis)', () => {
    const a = analyze('const C = () => <div className={`flex ${dir} gap-2`} />')
    expect(a.kind).toBe('template')
    if (a.kind === 'template') expect(a.quasis.map((q) => q.text)).toEqual(['flex ', ' gap-2'])
  })

  it('exposes each string argument of cn() as an editable span', () => {
    const a = analyze("const C = () => <div className={cn('p-4', 'text-red-500')} />")
    expect(a).toMatchObject({ kind: 'spans', partial: false })
    if (a.kind === 'spans') expect(a.spans.map((s) => s.text)).toEqual(['p-4', 'text-red-500'])
  })

  it('marks cn() with a dynamic argument as a partial edit (static args only)', () => {
    const a = analyze("const C = () => <div className={cn('p-4', on && 'text-red-500')} />")
    expect(a).toMatchObject({ kind: 'spans', partial: true })
    if (a.kind === 'spans') expect(a.spans.map((s) => s.text)).toEqual(['p-4'])
  })

  it('supports the clsx alias', () => {
    const a = analyze("const C = () => <div className={clsx('p-4')} />")
    expect(a.kind).toBe('spans')
  })

  it('falls back to inserting an argument when cn() has no string literal', () => {
    const a = analyze('const C = () => <div className={cn(base, on && x)} />')
    expect(a).toMatchObject({ kind: 'insert-arg', trailing: true })
  })

  it('inserts into an empty cn() without a trailing comma', () => {
    const a = analyze('const C = () => <div className={cn()} />')
    expect(a).toMatchObject({ kind: 'insert-arg', trailing: false })
  })

  it('reports a className-less element as absent', () => {
    const a = analyze('const C = () => <div id="x" />')
    expect(a.kind).toBe('absent')
  })

  it.each([
    ['variable reference', 'const C = () => <div className={cls} />', 'variable reference'],
    ['CSS Modules member', 'const C = () => <div className={styles.card} />', 'member expression'],
    ['conditional', "const C = () => <div className={on ? 'a' : 'b'} />", 'conditional'],
    ['unknown helper', 'const C = () => <div className={mangle("p-4")} />', 'unsupported helper'],
  ])('reports %s as unsupported with a specific reason', (_label, code, reasonFragment) => {
    const a = analyze(code)
    expect(a.kind).toBe('unsupported')
    if (a.kind === 'unsupported') expect(a.reason).toContain(reasonFragment)
  })
})
