// @vitest-environment happy-dom
// Pins the origin-instrumentation patches: a page-JS style/class mutation must tag its element, the
// originals must still run (call-through), and uninstall must restore the native methods. The
// DevTools-bypasses-page-JS premise can't be exercised here (no inspector backend) — it's validated
// live in a real browser; these tests pin the page-side mechanism the premise relies on.
import { describe, it, expect, afterEach } from 'vitest'
import {
  installProvenance,
  uninstallProvenance,
  consumeProvenance,
  isProvenanceInstalled,
} from '../src/provenance'

afterEach(() => {
  uninstallProvenance()
  document.body.innerHTML = ''
})

function div(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('installProvenance — inline style writes', () => {
  it('tags a setProperty write with the specific watched property, and calls through', () => {
    installProvenance()
    const el = div()
    el.style.setProperty('opacity', '0.5')

    expect(el.style.getPropertyValue('opacity')).toBe('0.5') // call-through preserved
    const prov = consumeProvenance(el)
    expect(prov.props.has('opacity')).toBe(true)
    expect(prov.broad).toBe(false)
  })

  it('tags a per-property accessor write (el.style.color = …)', () => {
    installProvenance()
    const el = div()
    el.style.color = 'rgb(255, 0, 0)'

    expect(el.style.color).toBe('rgb(255, 0, 0)')
    expect(consumeProvenance(el).props.has('color')).toBe(true)
  })

  it('tags a shorthand write (padding) as broad — it affects watched longhands', () => {
    installProvenance()
    const el = div()
    el.style.setProperty('padding', '8px')

    const prov = consumeProvenance(el)
    expect(prov.broad).toBe(true)
    // The shorthand itself is not a watched longhand, so it is not in `props`.
    expect(prov.props.size).toBe(0)
  })

  it('ignores writes to unsupported properties (transform)', () => {
    installProvenance()
    const el = div()
    el.style.setProperty('transform', 'translateX(10px)')

    const prov = consumeProvenance(el)
    expect(prov.props.size).toBe(0)
    expect(prov.broad).toBe(false)
  })

  it('tags a custom-property write as broad — it can feed any watched value via var()', () => {
    installProvenance()
    const el = div()
    el.style.setProperty('--accent', 'rgb(1, 2, 3)')

    expect(consumeProvenance(el).broad).toBe(true)
  })

  it('tags every watched property named in a setAttribute("style", …) write', () => {
    installProvenance()
    const el = div()
    el.setAttribute('style', 'opacity: 0.4; color: rgb(1, 2, 3); transform: scale(2)')

    const prov = consumeProvenance(el)
    expect(prov.props.has('opacity')).toBe(true)
    expect(prov.props.has('color')).toBe(true)
    expect(prov.props.size).toBe(2) // transform ignored
  })
})

describe('installProvenance — class / attribute writes', () => {
  it('tags a non-style setAttribute (class) as broad', () => {
    installProvenance()
    const el = div()
    el.setAttribute('class', 'is-visible')

    expect(el.getAttribute('class')).toBe('is-visible')
    expect(consumeProvenance(el).broad).toBe(true)
  })

  it('tags a className assignment as broad', () => {
    installProvenance()
    const el = div()
    el.className = 'foo'

    expect(el.className).toBe('foo')
    expect(consumeProvenance(el).broad).toBe(true)
  })

  it('tags a data-attribute change as broad', () => {
    installProvenance()
    const el = div()
    el.setAttribute('data-step', '2')

    expect(consumeProvenance(el).broad).toBe(true)
  })
})

describe('consumeProvenance', () => {
  it('clears markers after reading (consume-once)', () => {
    installProvenance()
    const el = div()
    el.style.setProperty('opacity', '0.5')

    expect(consumeProvenance(el).props.has('opacity')).toBe(true)
    const second = consumeProvenance(el)
    expect(second.props.size).toBe(0)
    expect(second.broad).toBe(false)
  })

  it('returns empty for an element that was never mutated', () => {
    installProvenance()
    const prov = consumeProvenance(div())
    expect(prov.props.size).toBe(0)
    expect(prov.broad).toBe(false)
  })
})

describe('installProvenance — lifecycle', () => {
  it('is idempotent', () => {
    installProvenance()
    installProvenance()
    expect(isProvenanceInstalled()).toBe(true)
  })

  it('restores native methods on uninstall — writes no longer tag', () => {
    installProvenance()
    expect(isProvenanceInstalled()).toBe(true)
    uninstallProvenance()
    expect(isProvenanceInstalled()).toBe(false)

    const el = div()
    el.style.setProperty('opacity', '0.5')
    expect(el.style.getPropertyValue('opacity')).toBe('0.5') // still works…
    expect(consumeProvenance(el).props.size).toBe(0) // …but no marker recorded
  })
})
