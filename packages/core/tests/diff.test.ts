import { describe, it, expect } from 'vitest'
import { buildSourceDiff } from '../src/diff'

describe('buildSourceDiff', () => {
  it('carries the file path through to the diff header', () => {
    const diff = buildSourceDiff('src/App.tsx', 'a\n', 'b\n')
    expect(diff.filePath).toBe('src/App.tsx')
  })

  it('returns no hunks when the text is unchanged', () => {
    const code = 'export const x = <div className="p-4" />\n'
    expect(buildSourceDiff('App.tsx', code, code).hunks).toEqual([])
  })

  it('emits a del + add line for a one-line className change, prefixes stripped', () => {
    const before = 'function App() {\n  return <div className="pl-4">hi</div>\n}\n'
    const after = 'function App() {\n  return <div className="pl-6">hi</div>\n}\n'
    const diff = buildSourceDiff('App.tsx', before, after)

    expect(diff.hunks).toHaveLength(1)
    const lines = diff.hunks[0]!.lines
    const del = lines.find((l) => l.kind === 'del')
    const add = lines.find((l) => l.kind === 'add')
    expect(del?.text).toBe('  return <div className="pl-4">hi</div>')
    expect(add?.text).toBe('  return <div className="pl-6">hi</div>')
    // The unchanged surrounding lines come through as context, gutter-free.
    expect(lines.some((l) => l.kind === 'context' && l.text === 'function App() {')).toBe(true)
  })

  it('reports 1-based hunk start lines', () => {
    const before = ['a', 'b', 'c', 'd', 'e'].join('\n') + '\n'
    const after = ['a', 'b', 'C', 'd', 'e'].join('\n') + '\n'
    const hunk = buildSourceDiff('f.txt', before, after).hunks[0]!
    expect(hunk.oldStart).toBe(1) // 3 lines of context pushes the hunk back to line 1
    expect(hunk.newStart).toBe(1)
  })

  it('drops the "\\ No newline at end of file" marker rather than rendering it', () => {
    const diff = buildSourceDiff('f.txt', 'one\ntwo', 'one\nTWO')
    const allText = diff.hunks.flatMap((h) => h.lines).map((l) => l.text)
    expect(allText.some((t) => t.includes('No newline'))).toBe(false)
  })
})
