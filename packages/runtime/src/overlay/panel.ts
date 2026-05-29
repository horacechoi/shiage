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

// Lucide-style inline SVG (MIT-licensed path data). Rendered via innerHTML on a span — these
// strings are all owned by the runtime; no user content is interpolated, so XSS is a non-issue.
// Stroke-based, 24×24 viewBox; `currentColor` lets CSS recolor (e.g. the error variant).
const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

const ICONS = {
  // square-pen — the Shiage "edit a stamped element" mark; used on tracking-state titles + pill.
  edit:
    `<svg ${SVG_ATTRS}>` +
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
    '<path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>' +
    '</svg>',
  // save — saving + preview titles.
  save:
    `<svg ${SVG_ATTRS}>` +
    '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>' +
    '<path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/>' +
    '<path d="M7 3v4a1 1 0 0 0 1 1h7"/>' +
    '</svg>',
  // triangle-alert — no-edit title (the save produced nothing to write).
  warn:
    `<svg ${SVG_ATTRS}>` +
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' +
    '<path d="M12 9v4"/>' +
    '<path d="M12 17h.01"/>' +
    '</svg>',
  // check — applied title (write succeeded).
  check: `<svg ${SVG_ATTRS}><path d="M20 6 9 17l-5-5"/></svg>`,
  // octagon-alert — error title.
  error:
    `<svg ${SVG_ATTRS}>` +
    '<path d="M12 16h.01"/>' +
    '<path d="M12 8v4"/>' +
    '<path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>' +
    '</svg>',
  // trash-2 — per-group Remove affordance (CSS class is still .shiage-group__remove).
  trash:
    `<svg ${SVG_ATTRS}>` +
    '<path d="M3 6h18"/>' +
    '<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>' +
    '<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>' +
    '<line x1="10" x2="10" y1="11" y2="17"/>' +
    '<line x1="14" x2="14" y1="11" y2="17"/>' +
    '</svg>',
} as const

type IconKey = keyof typeof ICONS

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

function iconSpan(icon: IconKey, className: string): HTMLSpanElement {
  const span = el('span', className)
  span.innerHTML = ICONS[icon]
  return span
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', className, label)
  btn.type = 'button'
  btn.addEventListener('click', onClick)
  return btn
}

/** A button whose visible content is an icon. The accessible name comes from `aria-label` and
 * `title` so the button is still discoverable to screen readers / keyboard users. */
function iconButton(
  icon: IconKey,
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = el('button', className)
  btn.type = 'button'
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.appendChild(iconSpan(icon, 'shiage-icon'))
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

/** Build the title-section that every state opens with: an icon-prefixed title row and an
 * optional muted subtitle, wrapped together so the panel's outer 16px gap doesn't push the
 * subtitle too far from its title (the section's own 8px gap keeps them paired). */
function titleSection(
  icon: IconKey,
  title: string,
  subtitle?: string,
  options?: { error?: boolean },
): HTMLElement {
  const section = el('div', 'shiage-title-section')
  const row = el('div', 'shiage-title-row')
  row.append(
    iconSpan(icon, 'shiage-title-icon'),
    el('span', `shiage-title${options?.error ? ' shiage-error' : ''}`, title),
  )
  section.append(row)
  if (subtitle !== undefined) section.append(el('div', 'shiage-muted', subtitle))
  return section
}

/** Render one ReviewElement as a collapsible-feeling group: header (element checkbox + tag + loc)
 * plus one row per property (property checkbox + "prop: old → new"). The element checkbox toggles
 * the whole group; property checkboxes carve out individual exclusions. */
function renderGroup(re: ReviewElement, callbacks: PanelCallbacks): HTMLElement {
  const group = el('div', `shiage-group${re.excluded ? ' shiage-group--excluded' : ''}`)

  const head = el('div', 'shiage-group__head')
  const headLeft = el('div', 'shiage-group__head-left')
  headLeft.append(
    checkbox(!re.excluded, (checked) => callbacks.onToggleElement(re.sourceLoc, !checked)),
    el('span', 'shiage-title', `<${re.tagName.toLowerCase()}>`),
    el('span', 'shiage-loc', re.sourceLoc),
  )
  head.append(
    headLeft,
    // Remove is per-element and destructive: pins every change to its baseline value and drops
    // the group from the panel. Unrelated edits on other elements in the batch are preserved.
    // Icon-only square at the right of the head — accessible name lives on aria-label/title.
    iconButton('trash', 'Remove', 'shiage-group__remove', () =>
      callbacks.onRemoveElement(re.sourceLoc),
    ),
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

  // Pill: icon-only round button. The connection dot is preserved but visually demoted to a small
  // 6px status indicator in the corner — green when the WS is open, gray/amber/red otherwise.
  // A count badge (top-right) appears when there are unsaved tracked changes.
  const dot = el('span', 'shiage-pill__dot shiage-pill__dot--closed')
  const pillIcon = iconSpan('edit', 'shiage-pill__icon')
  const pillBadge = el('span', 'shiage-pill__badge')
  pillBadge.hidden = true
  const pill = el('button', 'shiage-pill')
  pill.type = 'button'
  pill.setAttribute('aria-label', 'Shiage')
  pill.title = 'Shiage'
  pill.append(pillIcon, dot, pillBadge)
  pill.addEventListener('click', () => {
    panel.hidden = !panel.hidden
  })

  // Panel sits above the pill.
  root.append(panel, pill)
  parent.appendChild(root)

  function setBadgeCount(count: number): void {
    if (count > 0) {
      pillBadge.textContent = String(count)
      pillBadge.hidden = false
    } else {
      pillBadge.textContent = ''
      pillBadge.hidden = true
    }
  }

  function renderBody(view: PanelView): void {
    body.replaceChildren()

    switch (view.kind) {
      case 'tracking': {
        setBadgeCount(view.includedCount)
        body.append(
          titleSection('edit', 'Shiage', 'Edit CSS in DevTools to see changes here.'),
        )

        if (view.elements.length === 0) break

        const groups = el('div', 'shiage-groups')
        for (const re of view.elements) groups.append(renderGroup(re, callbacks))
        body.append(groups)

        const label =
          view.includedCount === 1 ? 'Save 1 change' : `Save ${view.includedCount} changes`
        const save = button(label, 'shiage-btn shiage-btn--primary', callbacks.onSave)
        save.disabled = view.includedCount === 0
        body.append(save)
        break
      }
      case 'saving': {
        setBadgeCount(0)
        body.append(titleSection('save', 'Saving', 'Computing the source edits.'))
        break
      }
      case 'preview': {
        setBadgeCount(0)
        body.append(titleSection('save', 'Review changes'))
        const diffs = el('div', 'shiage-diffs')
        for (const diff of view.diffs) diffs.append(renderDiff(diff))
        body.append(diffs)
        if (view.warnings.length > 0 || view.unsupported.length > 0) {
          const warnSection = el('div', 'shiage-warn-section')
          for (const warning of view.warnings) {
            warnSection.append(el('div', 'shiage-warn', warning))
          }
          if (view.unsupported.length > 0) {
            warnSection.append(
              el('div', 'shiage-warn', `Not supported in v1: ${view.unsupported.join(', ')}`),
            )
          }
          body.append(warnSection)
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
        setBadgeCount(0)
        body.append(
          titleSection('warn', 'No change written', view.reason),
          button('Cancel', 'shiage-btn shiage-btn--narrow', callbacks.onCancel),
        )
        break
      }
      case 'applied': {
        setBadgeCount(0)
        body.append(
          titleSection('check', 'Saved', 'The files were updated; HMR will repaint.'),
          button('Done', 'shiage-btn shiage-btn--primary', callbacks.onCancel),
        )
        break
      }
      case 'error': {
        setBadgeCount(0)
        body.append(
          titleSection('error', 'Error', view.message, { error: true }),
          button('Back', 'shiage-btn shiage-btn--narrow', callbacks.onCancel),
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
