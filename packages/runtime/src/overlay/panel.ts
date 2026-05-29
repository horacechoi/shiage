// The overlay UI: a floating pill that expands to a panel. The panel is a pure view of the
// orchestrator's state — `render(view)` rebuilds the body for the current step (tracking → saving
// → preview → applied) and the orchestrator owns all transitions. The panel only emits intent via
// callbacks (save / confirm / cancel, plus per-element / per-property exclude toggles). Lives
// inside the overlay's closed Shadow DOM.
//
// In the ambient-tracking flow there is no "picked element": Shiage watches every stamped element
// and surfaces all detected changes here, grouped by element. The user reviews and unchecks any
// they didn't mean to make, then saves the whole batch at once.
import type { PropertyChange, SourceDiff } from '@shiage/core/protocol'
import type { WsStatus } from '../client/ws-client'
import { renderDiff } from '../diff/render'

/** One element's contribution to the tracking view, as the orchestrator computed it from the
 * watch manager + the user's exclusion state. `excluded`/`excludedProps` flow IN; toggles call
 * back out so the orchestrator can mutate its sets and re-render. */
export interface ReviewElement {
  /** Stable group key — survives an HMR re-render of the same source site. */
  sourceLoc: string
  /** UPPERCASE per DOM convention; the panel lowercases for display. */
  tagName: string
  changes: PropertyChange[]
  excluded: boolean
  excludedProps: ReadonlySet<string>
}

export type PanelView =
  | { kind: 'tracking'; elements: ReviewElement[]; includedCount: number }
  | { kind: 'saving' }
  | { kind: 'preview'; diffs: SourceDiff[]; warnings: string[]; unsupported: string[] }
  | { kind: 'no-edit'; reason: string }
  | { kind: 'applied' }
  | { kind: 'error'; message: string }

export interface PanelCallbacks {
  /** Send the included changes for a batched diff preview. */
  onSave(): void
  /** Confirm the previewed batch (write all files). */
  onConfirm(): void
  /** Dismiss the current message and return to tracking. */
  onCancel(): void
  /** Whole-element toggle: `excluded=true` drops every change on this element from the save. */
  onToggleElement(sourceLoc: string, excluded: boolean): void
  /** Per-property toggle: `excluded=true` drops just this property from this element. */
  onToggleProperty(sourceLoc: string, property: string, excluded: boolean): void
  /** Wipe this element from the tracking view entirely: pin every change to its baseline value
   * (visual revert that sticks until apply success or refresh) AND remove the group from the
   * panel. Use when the user has decided none of these changes are intentional. */
  onRemoveElement(sourceLoc: string): void
}

export interface Panel {
  render(view: PanelView): void
  setConnection(status: WsStatus): void
  open(): void
  destroy(): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', className, label)
  btn.type = 'button'
  btn.addEventListener('click', onClick)
  return btn
}

function checkbox(checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.className = 'shiage-check'
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  return input
}

/** Render one ReviewElement as a collapsible-feeling group: header (element checkbox + tag + loc)
 * plus one row per property (property checkbox + "prop: old → new"). The element checkbox toggles
 * the whole group; property checkboxes carve out individual exclusions. */
function renderGroup(re: ReviewElement, callbacks: PanelCallbacks): HTMLElement {
  const group = el('div', `shiage-group${re.excluded ? ' shiage-group--excluded' : ''}`)

  const head = el('div', 'shiage-group__head')
  head.append(
    checkbox(!re.excluded, (checked) => callbacks.onToggleElement(re.sourceLoc, !checked)),
    el('span', 'shiage-title', `<${re.tagName.toLowerCase()}>`),
    el('span', 'shiage-loc', re.sourceLoc),
    // Remove is per-element and destructive: pins every change to its baseline value and drops
    // the group from the panel. Unrelated edits on other elements in the batch are preserved.
    // Lives at the right of the head via `margin-left: auto`.
    button('Remove', 'shiage-group__remove', () => callbacks.onRemoveElement(re.sourceLoc)),
  )
  group.append(head)

  for (const change of re.changes) {
    const propExcluded = re.excludedProps.has(change.property)
    const row = el(
      'div',
      `shiage-prop${re.excluded || propExcluded ? ' shiage-prop--excluded' : ''}`,
    )
    row.append(
      checkbox(!propExcluded, (checked) =>
        callbacks.onToggleProperty(re.sourceLoc, change.property, !checked),
      ),
      el('span', undefined, `${change.property}: ${change.oldValue} → ${change.newValue}`),
    )
    group.append(row)
  }
  return group
}

export function createPanel(parent: ParentNode & Node, callbacks: PanelCallbacks): Panel {
  const root = el('div', 'shiage-root')

  const panel = el('div', 'shiage-panel')
  panel.hidden = true
  const body = el('div', 'shiage-body')
  panel.appendChild(body)

  const dot = el('span', 'shiage-pill__dot shiage-pill__dot--closed')
  const pillLabel = el('span', undefined, 'Shiage')
  const pill = el('button', 'shiage-pill')
  pill.type = 'button'
  pill.append(dot, pillLabel)
  pill.addEventListener('click', () => {
    panel.hidden = !panel.hidden
  })

  // Panel sits above the pill.
  root.append(panel, pill)
  parent.appendChild(root)

  function renderBody(view: PanelView): void {
    body.replaceChildren()
    pillLabel.textContent = 'Shiage'

    switch (view.kind) {
      case 'tracking': {
        if (view.includedCount > 0) pillLabel.textContent = `Shiage · ${view.includedCount}`
        body.append(el('div', 'shiage-title', 'Shiage'))

        if (view.elements.length === 0) {
          body.append(el('div', 'shiage-muted', 'Edit CSS in DevTools to see changes here.'))
          break
        }

        for (const re of view.elements) body.append(renderGroup(re, callbacks))

        const label =
          view.includedCount === 1 ? 'Save 1 change' : `Save ${view.includedCount} changes`
        const save = button(label, 'shiage-btn shiage-btn--primary', callbacks.onSave)
        save.disabled = view.includedCount === 0
        body.append(save)
        break
      }
      case 'saving': {
        body.append(
          el('div', 'shiage-title', 'Saving…'),
          el('div', 'shiage-muted', 'Computing the source edits.'),
        )
        break
      }
      case 'preview': {
        body.append(el('div', 'shiage-title', 'Review changes'))
        for (const diff of view.diffs) body.append(renderDiff(diff))
        for (const warning of view.warnings) body.append(el('div', 'shiage-warn', warning))
        if (view.unsupported.length > 0) {
          body.append(
            el('div', 'shiage-warn', `Not supported in v1: ${view.unsupported.join(', ')}`),
          )
        }
        const row = el('div', 'shiage-btn-row')
        row.append(
          button('Cancel', 'shiage-btn', callbacks.onCancel),
          button('Confirm & write', 'shiage-btn shiage-btn--primary', callbacks.onConfirm),
        )
        body.append(row)
        break
      }
      case 'no-edit': {
        body.append(
          el('div', 'shiage-title', 'No change written'),
          el('div', 'shiage-muted', view.reason),
          button('Back', 'shiage-btn', callbacks.onCancel),
        )
        break
      }
      case 'applied': {
        body.append(
          el('div', 'shiage-title', 'Saved ✓'),
          el('div', 'shiage-muted', 'The files were updated; HMR will repaint.'),
          button('Done', 'shiage-btn shiage-btn--primary', callbacks.onCancel),
        )
        break
      }
      case 'error': {
        body.append(
          el('div', 'shiage-title shiage-error', 'Error'),
          el('div', 'shiage-muted', view.message),
          button('Back', 'shiage-btn', callbacks.onCancel),
        )
        break
      }
    }
  }

  // Surface results without making the user click the pill. Auto-open for any view that needs a
  // response, and for tracking the moment a save's worth of changes shows up (0→>0).
  return {
    render(view) {
      renderBody(view)
      const autoOpen =
        view.kind === 'saving' ||
        view.kind === 'preview' ||
        view.kind === 'no-edit' ||
        view.kind === 'applied' ||
        view.kind === 'error' ||
        (view.kind === 'tracking' && view.includedCount > 0)
      if (autoOpen) panel.hidden = false
    },
    setConnection(status) {
      dot.className = `shiage-pill__dot shiage-pill__dot--${status}`
    },
    open() {
      panel.hidden = false
    },
    destroy() {
      root.remove()
    },
  }
}
