import { describe, it, expect } from 'vitest'
import { expandToPhysical } from '../src/tailwind/expand'

describe('expandToPhysical', () => {
  it('expands the padding shorthand to all four sides', () => {
    expect(expandToPhysical({ property: 'padding', value: '16px' })).toEqual([
      { property: 'padding-top', value: '16px' },
      { property: 'padding-right', value: '16px' },
      { property: 'padding-bottom', value: '16px' },
      { property: 'padding-left', value: '16px' },
    ])
  })

  it('expands logical inline/block to physical pairs (LTR)', () => {
    expect(expandToPhysical({ property: 'padding-inline', value: '24px' })).toEqual([
      { property: 'padding-left', value: '24px' },
      { property: 'padding-right', value: '24px' },
    ])
    expect(expandToPhysical({ property: 'padding-block', value: '24px' })).toEqual([
      { property: 'padding-top', value: '24px' },
      { property: 'padding-bottom', value: '24px' },
    ])
  })

  it('expands gap to row-gap and column-gap', () => {
    expect(expandToPhysical({ property: 'gap', value: '8px' })).toEqual([
      { property: 'row-gap', value: '8px' },
      { property: 'column-gap', value: '8px' },
    ])
  })

  it('expands border-width and border-radius shorthands', () => {
    expect(
      expandToPhysical({ property: 'border-width', value: '2px' }).map((d) => d.property),
    ).toEqual([
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
    ])
    expect(
      expandToPhysical({ property: 'border-radius', value: '8px' }).map((d) => d.property),
    ).toEqual([
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-left-radius',
    ])
  })

  it('maps logical corner radii to physical corners (LTR)', () => {
    expect(expandToPhysical({ property: 'border-start-start-radius', value: '8px' })).toEqual([
      { property: 'border-top-left-radius', value: '8px' },
    ])
  })

  it('passes physical longhands and singletons through unchanged', () => {
    expect(expandToPhysical({ property: 'padding-left', value: '24px' })).toEqual([
      { property: 'padding-left', value: '24px' },
    ])
    expect(expandToPhysical({ property: 'width', value: '256px' })).toEqual([
      { property: 'width', value: '256px' },
    ])
    expect(expandToPhysical({ property: 'color', value: 'rgb(239, 68, 68)' })).toEqual([
      { property: 'color', value: 'rgb(239, 68, 68)' },
    ])
  })
})
