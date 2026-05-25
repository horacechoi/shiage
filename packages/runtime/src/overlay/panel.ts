// The overlay UI: a floating pill that expands to a panel. The panel is a pure view of the
// orchestrator's state — `render(view)` rebuilds the body for the current step (idle → picking →
// picked → review → applied) and the orchestrator owns all transitions. The panel only emits intent
// via callbacks (pick / save / confirm / dismiss). Lives inside the overlay's closed Shadow DOM.
import type { SourceDiff } from '@shiage/core/protocol'
import type { WsStatus } from '../client/ws-client'
import { renderDiff } from '../diff/render'

export type PanelView =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'picked'; tagName: string; sourceLoc: string | null; changeCount: number }
  | { kind: 'saving' }
  | { kind: 'review'; diff: SourceDiff; warnings: string[]; unsupported: string[] }
  | { kind: 'no-edit'; reason: string }
  | { kind: 'applied' }
  | { kind: 'error'; message: string }

export interface PanelCallbacks {
  /** Enter (or re-enter) pick mode. */
  onPick(): void
  /** Send the current changes for a diff preview. */
  onSave(): void
  /** Confirm the previewed diff (write the file). */
  onConfirm(): void
  /** Dismiss a review/message and go back. */
  onCancel(): void
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
      case 'idle': {
        body.append(
          el('div', 'shiage-title', 'Shiage'),
          el('div', 'shiage-muted', 'No element picked.'),
          button('Pick element', 'shiage-btn shiage-btn--primary', callbacks.onPick),
        )
        break
      }
      case 'picking': {
        body.append(
          el('div', 'shiage-title', 'Pick an element'),
          el('div', 'shiage-muted', 'Click any element on the page. Press Esc to cancel.'),
        )
        break
      }
      case 'picked': {
        const noLoc = view.sourceLoc === null
        if (view.changeCount > 0) pillLabel.textContent = `Shiage · ${view.changeCount}`
        body.append(el('div', 'shiage-title', `<${view.tagName.toLowerCase()}>`))
        if (noLoc) {
          body.append(
            el(
              'div',
              'shiage-warn',
              'No source location on this element — is the Shiage plugin running in dev?',
            ),
          )
        } else {
          body.append(el('div', 'shiage-loc', view.sourceLoc!))
        }
        body.append(
          el(
            'div',
            'shiage-muted',
            view.changeCount === 0
              ? 'Edit CSS in DevTools to see changes here.'
              : `${view.changeCount} change${view.changeCount === 1 ? '' : 's'} detected.`,
          ),
        )
        const save = button(
          view.changeCount === 1 ? 'Save 1 change' : `Save ${view.changeCount} changes`,
          'shiage-btn shiage-btn--primary',
          callbacks.onSave,
        )
        save.disabled = noLoc || view.changeCount === 0
        body.append(save, button('Pick another element', 'shiage-btn', callbacks.onPick))
        break
      }
      case 'saving': {
        body.append(
          el('div', 'shiage-title', 'Saving…'),
          el('div', 'shiage-muted', 'Computing the source edit.'),
        )
        break
      }
      case 'review': {
        body.append(el('div', 'shiage-title', 'Review change'))
        body.append(renderDiff(view.diff))
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
          el('div', 'shiage-muted', 'The file was updated; HMR will repaint.'),
          button('Pick another element', 'shiage-btn shiage-btn--primary', callbacks.onPick),
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

  // Surface results without making the user click the pill.
  const autoOpenViews = new Set<PanelView['kind']>([
    'picking',
    'saving',
    'review',
    'no-edit',
    'applied',
    'error',
  ])

  return {
    render(view) {
      renderBody(view)
      if (autoOpenViews.has(view.kind) || (view.kind === 'picked' && view.changeCount > 0)) {
        panel.hidden = false
      }
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
