import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editJsxSource, editJsxFile, type EditResult } from '../src/ast/edit'
import { stampLocOf } from './_jsx-helpers'

const code = (r: EditResult): string => {
  if (r.status !== 'edited') throw new Error(`expected edited, got ${r.status}`)
  return r.code
}

// Edit the (single) element of the given tag in `src`.
const editTag = (src: string, tag: string, add: string[], remove: string[] = []): EditResult =>
  editJsxSource(src, 'T.tsx', stampLocOf(src, tag), { add, remove })

describe('editJsxSource — string literals', () => {
  it('changes only the className substring and preserves all other formatting', () => {
    const src = [
      'export function Card() {',
      '  return (',
      '    <button className="p-4 text-red-500" onClick={save}>',
      '      Save',
      '    </button>',
      '  )',
      '}',
      '',
    ].join('\n')
    const out = code(editTag(src, 'button', ['pl-6']))
    expect(out).toBe(src.replace('p-4 text-red-500', 'p-4 text-red-500 pl-6'))
  })

  it('replaces a conflicting class (add + remove) in place', () => {
    const src = 'const C = () => <div className="text-blue-500 font-bold">x</div>'
    const out = code(editTag(src, 'div', ['text-red-500'], ['text-blue-500']))
    expect(out).toBe('const C = () => <div className="font-bold text-red-500">x</div>')
  })

  it('does not duplicate a class that is already present', () => {
    const src = 'const C = () => <div className="p-4 pl-6">x</div>'
    expect(code(editTag(src, 'div', ['pl-6']))).toBe(src)
  })
})

describe('editJsxSource — inserting a className', () => {
  it('inserts an attribute on an element that has none', () => {
    const src = 'const C = () => <div>x</div>'
    expect(code(editTag(src, 'div', ['p-4']))).toBe('const C = () => <div className="p-4">x</div>')
  })

  it('inserts after the tag name, before existing attributes', () => {
    const src = 'const C = () => <section id="x">hi</section>'
    const out = code(editTag(src, 'section', ['p-6', 'bg-white']))
    expect(out).toBe('const C = () => <section className="p-6 bg-white" id="x">hi</section>')
  })
})

describe('editJsxSource — cn()/clsx()', () => {
  it('edits the first string arg and removes from a sibling string arg', () => {
    const src = "const C = () => <a className={cn('p-4', 'text-blue-500')}>x</a>"
    // The emptied sibling arg is left as '' — harmless to cn(), and we never touch dynamic args.
    const out = code(editTag(src, 'a', ['text-red-500'], ['text-blue-500']))
    expect(out).toBe("const C = () => <a className={cn('p-4 text-red-500', '')}>x</a>")
  })

  it('edits static args only and warns when an argument is dynamic (partial)', () => {
    const src = "const C = () => <a className={cn('p-4', on && 'text-blue-500')}>x</a>"
    const r = editTag(src, 'a', ['pl-6'])
    expect(code(r)).toBe(
      "const C = () => <a className={cn('p-4 pl-6', on && 'text-blue-500')}>x</a>",
    )
    if (r.status === 'edited') expect(r.warnings.some((w) => w.includes('static'))).toBe(true)
  })

  it('injects a leading string argument when cn() has only dynamic args', () => {
    const src = 'const C = () => <a className={cn(base, on && extra)}>x</a>'
    expect(code(editTag(src, 'a', ['p-4']))).toBe(
      "const C = () => <a className={cn('p-4', base, on && extra)}>x</a>",
    )
  })
})

describe('editJsxSource — template literals', () => {
  it('edits a quasi without disturbing ${…} or its surrounding whitespace', () => {
    const src = 'const C = () => <span className={`flex ${dir} gap-2`}>x</span>'
    const r = editTag(src, 'span', ['pl-6'], ['gap-2'])
    expect(code(r)).toBe('const C = () => <span className={`flex ${dir} pl-6`}>x</span>')
    if (r.status === 'edited') expect(r.warnings.some((w) => w.includes('static'))).toBe(true)
  })

  it('appends after an interpolation that ends the template, with one separating space', () => {
    const src = 'const C = () => <span className={`p-4 ${dir}`}>x</span>'
    expect(code(editTag(src, 'span', ['gap-2']))).toBe(
      'const C = () => <span className={`p-4 ${dir} gap-2`}>x</span>',
    )
  })

  it('edits an expression-less template like a plain string', () => {
    const src = 'const C = () => <span className={`p-4 flex`}>x</span>'
    expect(code(editTag(src, 'span', ['gap-2']))).toBe(
      'const C = () => <span className={`p-4 flex gap-2`}>x</span>',
    )
  })
})

describe('editJsxSource — failures', () => {
  it('returns unsupported with a reason for a CSS-Modules className', () => {
    const r = editTag('const C = () => <div className={styles.card}>x</div>', 'div', ['p-4'])
    expect(r.status).toBe('unsupported')
    if (r.status === 'unsupported') expect(r.reason).toContain('member expression')
  })

  it('returns unsupported for a variable-reference className', () => {
    const r = editTag('const C = () => <div className={cls}>x</div>', 'div', ['p-4'])
    expect(r).toMatchObject({ status: 'unsupported' })
  })

  it('returns not-found when no element is at the location', () => {
    const r = editJsxSource(
      'const C = () => <div />',
      'T.tsx',
      { line: 99, column: 1 },
      {
        add: ['p-4'],
        remove: [],
      },
    )
    expect(r.status).toBe('not-found')
  })

  it('returns unsupported on a parse error', () => {
    const r = editJsxSource(
      'const C = () => <div',
      'T.tsx',
      { line: 1, column: 1 },
      {
        add: ['p-4'],
        remove: [],
      },
    )
    expect(r.status).toBe('unsupported')
    if (r.status === 'unsupported') expect(r.reason).toContain('parse error')
  })
})

describe('editJsxFile', () => {
  it('reads the file and returns new source without writing it (staging)', () => {
    const src = 'const C = () => <div className="p-4">x</div>\n'
    const path = join(tmpdir(), `shiage-edit-${process.pid}-${Date.now()}.tsx`)
    writeFileSync(path, src)
    try {
      const r = editJsxFile(path, stampLocOf(src, 'div'), { add: ['pl-6'], remove: [] })
      expect(code(r)).toBe('const C = () => <div className="p-4 pl-6">x</div>\n')
      // The edit is staged in memory; the file on disk is untouched until the server applies it.
      expect(readFileSync(path, 'utf8')).toBe(src)
    } finally {
      rmSync(path, { force: true })
    }
  })

  it('returns not-found for a missing file', () => {
    const r = editJsxFile(
      join(tmpdir(), 'shiage-does-not-exist.tsx'),
      { line: 1, column: 1 },
      {
        add: ['p-4'],
        remove: [],
      },
    )
    expect(r.status).toBe('not-found')
  })
})
