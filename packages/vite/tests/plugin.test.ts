// Unit coverage for the plugin's pure logic — the JSX-stamping transform and its file filter, plus
// the serve-only/pre shape. The full save → diff → write round-trip is exercised headlessly by
// @shiage/core's server.test.ts, and the in-page injection by the manual/browser checklist.
import { describe, it, expect } from 'vitest'
import shiage, { type ShiageOptions } from '../src/index'

// Our hooks are plain functions; cast past Vite's ObjectHook typing to call them directly.
type TransformFn = (code: string, id: string) => { code: string } | null
type ConfigResolvedFn = (config: { root: string }) => void

function build(options?: ShiageOptions, root = '/proj') {
  const plugin = shiage(options)
  ;(plugin.configResolved as unknown as ConfigResolvedFn)({ root })
  return { plugin, transform: plugin.transform as unknown as TransformFn }
}

describe('shiage() vite plugin', () => {
  it('is a serve-only, pre-enforced plugin named shiage', () => {
    const plugin = shiage()
    expect(plugin.name).toBe('shiage')
    expect(plugin.apply).toBe('serve')
    expect(plugin.enforce).toBe('pre')
  })

  it('stamps data-shiage-loc onto host elements in .tsx, relative to the project root', () => {
    const { transform } = build()
    const out = transform('export const A = () => <div className="p-4" />', '/proj/src/App.tsx')
    expect(out?.code).toContain('data-shiage-loc="src/App.tsx:1:')
  })

  it('also stamps .jsx files', () => {
    const { transform } = build()
    const out = transform('export const A = () => <span>hi</span>', '/proj/src/App.jsx')
    expect(out?.code).toContain('data-shiage-loc="src/App.jsx:1:')
  })

  it('leaves non-JSX modules and anything under node_modules untouched', () => {
    const { transform } = build()
    expect(transform('export const x = 1', '/proj/src/util.ts')).toBeNull()
    expect(transform('export const A = () => <div/>', '/proj/node_modules/x/App.jsx')).toBeNull()
  })

  it('does nothing when disabled', () => {
    const { transform } = build({ enabled: false })
    expect(transform('export const A = () => <div/>', '/proj/src/App.tsx')).toBeNull()
  })

  it('does not stamp uppercase component elements', () => {
    const { transform } = build()
    const out = transform('export const A = () => <Foo />', '/proj/src/App.tsx')
    expect(out?.code ?? '').not.toContain('data-shiage-loc')
  })
})
