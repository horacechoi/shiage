// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { startPicking, type PickResult } from '../src/picker/picker'
import { createHighlight } from '../src/picker/highlight'

afterEach(() => {
  document.body.innerHTML = ''
})

const clickOn = (el: Element) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

describe('startPicking', () => {
  it('resolves the nearest data-shiage-loc ancestor on click', () => {
    const host = document.createElement('div')
    host.setAttribute('data-shiage-loc', 'src/App.tsx:42:9')
    const inner = document.createElement('span')
    host.appendChild(inner)
    document.body.appendChild(host)

    const onPick = vi.fn<(r: PickResult) => void>()
    startPicking({ isOwnElement: () => false, onHover: () => {}, onPick, onCancel: () => {} })

    clickOn(inner)

    expect(onPick).toHaveBeenCalledOnce()
    const result = onPick.mock.calls[0]![0]
    expect(result.element).toBe(inner)
    expect(result.matchedElement).toBe(host)
    expect(result.sourceLoc).toBe('src/App.tsx:42:9')
  })

  it('reports a null sourceLoc when the click has no stamped ancestor', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const onPick = vi.fn<(r: PickResult) => void>()
    startPicking({ isOwnElement: () => false, onHover: () => {}, onPick, onCancel: () => {} })

    clickOn(el)

    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick.mock.calls[0]![0].sourceLoc).toBeNull()
  })

  it('ignores clicks on the overlay’s own elements', () => {
    const own = document.createElement('div')
    own.setAttribute('data-shiage-loc', 'should/not:1:1')
    document.body.appendChild(own)
    const onPick = vi.fn()
    startPicking({ isOwnElement: () => true, onHover: () => {}, onPick, onCancel: () => {} })

    clickOn(own)

    expect(onPick).not.toHaveBeenCalled()
  })

  it('swallows the pick click so the app does not also receive it', () => {
    const target = document.createElement('a')
    target.setAttribute('data-shiage-loc', 'src/App.tsx:5:3')
    document.body.appendChild(target)
    const appHandler = vi.fn()
    document.body.addEventListener('click', appHandler) // bubble-phase app handler

    startPicking({
      isOwnElement: () => false,
      onHover: () => {},
      onPick: () => {},
      onCancel: () => {},
    })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(appHandler).not.toHaveBeenCalled()
  })

  it('cancels on Escape and stops listening', () => {
    const onCancel = vi.fn()
    const onPick = vi.fn()
    startPicking({ isOwnElement: () => false, onHover: () => {}, onPick, onCancel })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalledOnce()

    // After cancel, listeners are removed: a subsequent click does not pick.
    const el = document.createElement('div')
    document.body.appendChild(el)
    clickOn(el)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('stop() removes listeners', () => {
    const onPick = vi.fn()
    const stop = startPicking({
      isOwnElement: () => false,
      onHover: () => {},
      onPick,
      onCancel: () => {},
    })
    stop()
    const el = document.createElement('div')
    document.body.appendChild(el)
    clickOn(el)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('reports hovered elements, and null over its own UI', () => {
    const page = document.createElement('div')
    const own = document.createElement('div')
    document.body.append(page, own)
    const onHover = vi.fn()
    startPicking({
      isOwnElement: (el) => el === own,
      onHover,
      onPick: () => {},
      onCancel: () => {},
    })

    page.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    expect(onHover).toHaveBeenLastCalledWith(page)

    own.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    expect(onHover).toHaveBeenLastCalledWith(null)
  })
})

describe('createHighlight', () => {
  it('shows over an element and hides', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const highlight = createHighlight(parent)

    const box = parent.querySelector('.shiage-highlight') as HTMLElement
    expect(box).toBeTruthy()
    expect(box.style.display).toBe('none')

    highlight.show(document.body)
    expect(box.style.display).toBe('block')

    highlight.hide()
    expect(box.style.display).toBe('none')

    highlight.destroy()
    expect(parent.querySelector('.shiage-highlight')).toBeNull()
  })
})
