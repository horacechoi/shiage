// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createPanel, type PanelCallbacks } from '../src/overlay/panel'
import { renderDiff } from '../src/diff/render'
import type { SourceDiff } from '@shiage/core/protocol'

afterEach(() => {
  document.body.innerHTML = ''
})

const noopCallbacks = (): PanelCallbacks => ({
  onPick: vi.fn(),
  onSave: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
})

describe('createPanel', () => {
  it('renders the picked view with an enabled Save button and a change count', () => {
    const cb = noopCallbacks()
    const panel = createPanel(document.body, cb)
    panel.render({
      kind: 'picked',
      tagName: 'BUTTON',
      sourceLoc: 'src/App.tsx:1:1',
      changeCount: 2,
    })

    const save = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Save 2 changes'),
    ) as HTMLButtonElement
    expect(save).toBeTruthy()
    expect(save.disabled).toBe(false)
    save.click()
    expect(cb.onSave).toHaveBeenCalledOnce()
  })

  it('disables Save when there are no changes or no source location', () => {
    const panel = createPanel(document.body, noopCallbacks())
    panel.render({ kind: 'picked', tagName: 'DIV', sourceLoc: 'a:1:1', changeCount: 0 })
    let save = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Save'),
    ) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    panel.render({ kind: 'picked', tagName: 'DIV', sourceLoc: null, changeCount: 3 })
    expect(document.body.textContent).toContain('No source location')
    save = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Save'),
    ) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('renders a review with the diff and wires Confirm/Cancel', () => {
    const cb = noopCallbacks()
    const panel = createPanel(document.body, cb)
    const diff: SourceDiff = {
      filePath: 'src/App.tsx',
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          lines: [
            { kind: 'del', text: 'a' },
            { kind: 'add', text: 'b' },
          ],
        },
      ],
    }
    panel.render({
      kind: 'review',
      diff,
      warnings: ['Matched #fee to red-500'],
      unsupported: ['display'],
    })

    expect(document.querySelector('.shiage-diff')).toBeTruthy()
    expect(document.body.textContent).toContain('Matched #fee to red-500')
    expect(document.body.textContent).toContain('Not supported in v1: display')

    const confirm = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Confirm & write',
    )!
    confirm.click()
    expect(cb.onConfirm).toHaveBeenCalledOnce()
  })

  it('reflects connection status on the pill dot', () => {
    const panel = createPanel(document.body, noopCallbacks())
    panel.setConnection('open')
    expect(document.querySelector('.shiage-pill__dot--open')).toBeTruthy()
    panel.setConnection('closed')
    expect(document.querySelector('.shiage-pill__dot--closed')).toBeTruthy()
  })
})

describe('renderDiff', () => {
  it('renders a file header and +/- gutters per line', () => {
    const diff: SourceDiff = {
      filePath: 'src/Card.tsx',
      hunks: [
        {
          oldStart: 41,
          newStart: 41,
          lines: [
            { kind: 'context', text: '<button' },
            { kind: 'del', text: '  className="p-4"' },
            { kind: 'add', text: '  className="p-4 pl-6"' },
          ],
        },
      ],
    }
    const node = renderDiff(diff)
    expect(node.querySelector('.shiage-diff__file')!.textContent).toBe('src/Card.tsx')
    expect(node.querySelectorAll('.shiage-diff__line')).toHaveLength(3)
    expect(node.querySelector('.shiage-diff__line--add')!.textContent).toContain('+')
    expect(node.querySelector('.shiage-diff__line--del')!.textContent).toContain('-')
  })

  it('sets line text via textContent (no markup injection)', () => {
    const diff: SourceDiff = {
      filePath: 'x',
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          lines: [{ kind: 'add', text: '<img src=x onerror=alert(1)>' }],
        },
      ],
    }
    const node = renderDiff(diff)
    expect(node.querySelector('img')).toBeNull()
    expect(node.querySelector('.shiage-diff__text')!.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    )
  })
})
