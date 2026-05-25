import { describe, it, expect } from 'vitest'
import { mergeClassString } from '../src/ast/merge'

describe('mergeClassString', () => {
  it('appends an addition that is not already present', () => {
    expect(mergeClassString('p-4 text-red-500', ['pl-6'], [])).toBe('p-4 text-red-500 pl-6')
  })

  it('drops a removed token and appends the replacement, preserving surviving order', () => {
    expect(mergeClassString('text-blue-500 font-bold', ['text-red-500'], ['text-blue-500'])).toBe(
      'font-bold text-red-500',
    )
  })

  it('never duplicates an addition that already exists', () => {
    expect(mergeClassString('p-4 pl-6', ['pl-6'], [])).toBe('p-4 pl-6')
  })

  it('leaves variant-prefixed and unrelated tokens untouched', () => {
    expect(mergeClassString('md:p-4 hover:bg-black w-32', ['w-64'], ['w-32'])).toBe(
      'md:p-4 hover:bg-black w-64',
    )
  })

  it('collapses irregular whitespace to single spaces', () => {
    expect(mergeClassString('p-4   text-red-500\tfont-bold', [], [])).toBe(
      'p-4 text-red-500 font-bold',
    )
  })

  it('returns deduped additions when the existing string is empty', () => {
    expect(mergeClassString('', ['pl-6', 'pl-6', 'mt-2'], [])).toBe('pl-6 mt-2')
  })

  it('does not reorder when only adding', () => {
    expect(mergeClassString('z-10 flex p-4', ['gap-2'], [])).toBe('z-10 flex p-4 gap-2')
  })
})
