// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createPanel, type PanelCallbacks } from '../src/overlay/panel'
import { renderDiff } from '../src/diff/render'
import type { SourceDiff } from '@shiage/core/protocol'

afterEach(() => {
  document.body.innerHTML = ''
})

const noopCallbacks = (): PanelCallbacks => ({
  onSave: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  onToggleElement: vi.fn(),
  onToggleProperty: vi.fn(),
  onRemoveElement: vi.fn(),
})

describe('createPanel — tracking view', () => {
  it('renders one group per element with property rows and an enabled Save button', () => {
    const cb = noopCallbacks()
    const panel = createPanel(document.body, cb)
    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'App.tsx:1:1',
          tagName: 'BUTTON',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
          excluded: false,
          excludedProps: new Set(),
        },
        {
          sourceLoc: 'App.tsx:2:2',
          tagName: 'H1',
          changes: [
            { property: 'color', oldValue: 'rgb(0, 0, 0)', newValue: 'rgb(255, 255, 255)' },
            { property: 'font-size', oldValue: '16px', newValue: '24px' },
          ],
          excluded: false,
          excludedProps: new Set(),
        },
      ],
      includedCount: 3,
    })

    const groups = document.querySelectorAll('.shiage-group')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.textContent).toContain('<button>')
    expect(groups[0]!.textContent).toContain('App.tsx:1:1')
    expect(groups[0]!.textContent).toContain('padding-left: 16px → 24px')
    expect(groups[1]!.textContent).toContain('<h1>')
    expect(groups[1]!.textContent).toContain('font-size: 16px → 24px')

    const save = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Save 3 changes'),
    ) as HTMLButtonElement
    expect(save).toBeTruthy()
    expect(save.disabled).toBe(false)
    save.click()
    expect(cb.onSave).toHaveBeenCalledOnce()
  })

  it('shows the empty hint and hides the Save button when elements is empty', () => {
    const panel = createPanel(document.body, noopCallbacks())
    panel.render({ kind: 'tracking', elements: [], includedCount: 0 })

    expect(document.body.textContent).toContain('Edit CSS in DevTools to see changes here.')
    expect(document.querySelectorAll('.shiage-group')).toHaveLength(0)
    // No "Save" button rendered for the empty case (and certainly nothing enabled).
    const anySave = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Save'),
    )
    expect(anySave).toBeUndefined()
  })

  it('calls onToggleElement(loc, true) when the element checkbox is unchecked', () => {
    const cb = noopCallbacks()
    const panel = createPanel(document.body, cb)
    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'App.tsx:1:1',
          tagName: 'DIV',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
          excluded: false,
          excludedProps: new Set(),
        },
      ],
      includedCount: 1,
    })
    const headBox = document
      .querySelector('.shiage-group__head')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    headBox.checked = false
    headBox.dispatchEvent(new Event('change'))
    expect(cb.onToggleElement).toHaveBeenCalledWith('App.tsx:1:1', true)
  })

  it('calls onRemoveElement(loc) when the per-group Remove button is clicked', () => {
    const cb = noopCallbacks()
    const panel = createPanel(document.body, cb)
    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'App.tsx:1:1',
          tagName: 'DIV',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
          excluded: false,
          excludedProps: new Set(),
        },
        {
          sourceLoc: 'App.tsx:2:2',
          tagName: 'H1',
          changes: [{ property: 'font-size', oldValue: '16px', newValue: '24px' }],
          excluded: false,
          excludedProps: new Set(),
        },
      ],
      includedCount: 2,
    })
    const groups = document.querySelectorAll('.shiage-group')
    const secondRemove = groups[1]!.querySelector('.shiage-group__remove') as HTMLButtonElement
    expect(secondRemove).toBeTruthy()
    // The button is icon-only after the design refresh; the accessible name lives on aria-label.
    expect(secondRemove.getAttribute('aria-label')).toBe('Remove')
    secondRemove.click()
    expect(cb.onRemoveElement).toHaveBeenCalledWith('App.tsx:2:2')
    // Remove is independent of the exclusion toggles — neither fires on click.
    expect(cb.onToggleElement).not.toHaveBeenCalled()
    expect(cb.onToggleProperty).not.toHaveBeenCalled()
  })

  it('calls onToggleProperty(loc, prop, true) when a property checkbox is unchecked', () => {
    const cb = noopCallbacks()
    const panel = createPanel(document.body, cb)
    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'App.tsx:1:1',
          tagName: 'DIV',
          changes: [
            { property: 'padding-left', oldValue: '16px', newValue: '24px' },
            { property: 'color', oldValue: '#000', newValue: '#fff' },
          ],
          excluded: false,
          excludedProps: new Set(),
        },
      ],
      includedCount: 2,
    })
    const props = document.querySelectorAll('.shiage-prop')
    const colorBox = props[1]!.querySelector('input[type="checkbox"]') as HTMLInputElement
    colorBox.checked = false
    colorBox.dispatchEvent(new Event('change'))
    expect(cb.onToggleProperty).toHaveBeenCalledWith('App.tsx:1:1', 'color', true)
  })

  it('flags excluded elements and properties with class names so the CSS can mute them', () => {
    const panel = createPanel(document.body, noopCallbacks())
    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'App.tsx:1:1',
          tagName: 'DIV',
          changes: [
            { property: 'padding-left', oldValue: '16px', newValue: '24px' },
            { property: 'color', oldValue: '#000', newValue: '#fff' },
          ],
          excluded: false,
          excludedProps: new Set(['color']),
        },
        {
          sourceLoc: 'App.tsx:2:2',
          tagName: 'H1',
          changes: [{ property: 'font-size', oldValue: '16px', newValue: '24px' }],
          excluded: true,
          excludedProps: new Set(),
        },
      ],
      includedCount: 1,
    })
    const groups = document.querySelectorAll('.shiage-group')
    expect(groups[0]!.classList.contains('shiage-group--excluded')).toBe(false)
    expect(groups[1]!.classList.contains('shiage-group--excluded')).toBe(true)

    const firstGroupProps = groups[0]!.querySelectorAll('.shiage-prop')
    expect(firstGroupProps[0]!.classList.contains('shiage-prop--excluded')).toBe(false)
    expect(firstGroupProps[1]!.classList.contains('shiage-prop--excluded')).toBe(true)
  })

  it('renders a snapshot-only group when every change comes from excludedProps', () => {
    // Simulates the panel shape that mount.ts builds when every change on an element has been
    // per-row excluded and the tracker has therefore auto-cleared them — `changes` is sourced
    // entirely from snapshots, with every property in displayedExcludedProps. The panel should
    // still render the group, every row struck, every row's checkbox unchecked, the group head
    // NOT in --excluded (the element-level exclusion is independent).
    const cb = noopCallbacks()
    const panel = createPanel(document.body, cb)
    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'App.tsx:1:1',
          tagName: 'DIV',
          changes: [
            { property: 'padding-left', oldValue: '16px', newValue: '24px' },
            { property: 'color', oldValue: '#000', newValue: '#fff' },
          ],
          excluded: false,
          excludedProps: new Set(['padding-left', 'color']),
        },
      ],
      includedCount: 0,
    })
    const groups = document.querySelectorAll('.shiage-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.classList.contains('shiage-group--excluded')).toBe(false)
    const rows = groups[0]!.querySelectorAll('.shiage-prop')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.classList.contains('shiage-prop--excluded')).toBe(true)
      const box = row.querySelector('input[type="checkbox"]') as HTMLInputElement
      expect(box.checked).toBe(false)
    }
    // Re-ticking a snapshot row calls back with excluded=false (mount.ts then releases the hold).
    const firstBox = rows[0]!.querySelector('input[type="checkbox"]') as HTMLInputElement
    firstBox.checked = true
    firstBox.dispatchEvent(new Event('change'))
    expect(cb.onToggleProperty).toHaveBeenCalledWith('App.tsx:1:1', 'padding-left', false)
  })

  it('disables Save when includedCount is 0 even with non-empty (all-excluded) elements', () => {
    const panel = createPanel(document.body, noopCallbacks())
    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'App.tsx:1:1',
          tagName: 'DIV',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
          excluded: true,
          excludedProps: new Set(),
        },
      ],
      includedCount: 0,
    })
    const save = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Save'),
    ) as HTMLButtonElement
    expect(save).toBeTruthy()
    expect(save.disabled).toBe(true)
  })
})

describe('createPanel — preview view (multi-file)', () => {
  const mkDiff = (filePath: string, addText: string): SourceDiff => ({
    filePath,
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: 'del', text: 'x' },
          { kind: 'add', text: addText },
        ],
      },
    ],
  })

  it('renders one diff block per file and wires Confirm/Cancel', () => {
    const cb = noopCallbacks()
    const panel = createPanel(document.body, cb)
    panel.render({
      kind: 'preview',
      diffs: [mkDiff('src/Card.tsx', 'a'), mkDiff('src/Footer.tsx', 'b')],
      warnings: [],
      unsupported: [],
    })

    const diffNodes = document.querySelectorAll('.shiage-diff')
    expect(diffNodes).toHaveLength(2)
    expect(diffNodes[0]!.textContent).toContain('src/Card.tsx')
    expect(diffNodes[1]!.textContent).toContain('src/Footer.tsx')

    const confirm = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Confirm & write',
    )!
    confirm.click()
    expect(cb.onConfirm).toHaveBeenCalledOnce()

    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!
    cancel.click()
    expect(cb.onCancel).toHaveBeenCalledOnce()
  })

  it('renders warnings and the unsupported notice in preview', () => {
    const panel = createPanel(document.body, noopCallbacks())
    panel.render({
      kind: 'preview',
      diffs: [mkDiff('x', 'a')],
      warnings: ['Matched #fee to red-500'],
      unsupported: ['display'],
    })
    expect(document.body.textContent).toContain('Matched #fee to red-500')
    expect(document.body.textContent).toContain('Not supported in v1: display')
  })
})

describe('createPanel — misc', () => {
  it('reflects connection status on the pill dot', () => {
    const panel = createPanel(document.body, noopCallbacks())
    panel.setConnection('open')
    expect(document.querySelector('.shiage-pill__dot--open')).toBeTruthy()
    panel.setConnection('closed')
    expect(document.querySelector('.shiage-pill__dot--closed')).toBeTruthy()
  })

  it('auto-opens when a tracking view has changes; stays closed when empty', () => {
    const panel = createPanel(document.body, noopCallbacks())
    const panelEl = document.querySelector('.shiage-panel') as HTMLElement
    expect(panelEl.hidden).toBe(true)

    panel.render({ kind: 'tracking', elements: [], includedCount: 0 })
    expect(panelEl.hidden).toBe(true)

    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'App.tsx:1:1',
          tagName: 'DIV',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
          excluded: false,
          excludedProps: new Set(),
        },
      ],
      includedCount: 1,
    })
    expect(panelEl.hidden).toBe(false)
  })

  it('reveals the pill count badge only when includedCount > 0', () => {
    const panel = createPanel(document.body, noopCallbacks())
    const badge = document.querySelector('.shiage-pill__badge') as HTMLElement

    panel.render({ kind: 'tracking', elements: [], includedCount: 0 })
    expect(badge.hidden).toBe(true)
    expect(badge.textContent).toBe('')

    panel.render({
      kind: 'tracking',
      elements: [
        {
          sourceLoc: 'A.tsx:1:1',
          tagName: 'DIV',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
          excluded: false,
          excludedProps: new Set(),
        },
      ],
      includedCount: 1,
    })
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe('1')
  })
})

// `renderDiff` is unchanged in this phase — these tests pin the diff rendering behavior verbatim.
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
