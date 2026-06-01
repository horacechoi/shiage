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

// Inline SVG (lucide-MIT for the stroke icons; the table-edit mark is the project's own glyph
// supplied directly by the design). Rendered via innerHTML on a span — these strings are all
// owned by the runtime; no user content is interpolated, so XSS is a non-issue. Stroke icons use
// a 24×24 viewBox with `currentColor` stroke so CSS can recolor them (e.g. the error variant).
const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

const ICONS = {
  // table-edit — the Shiage "edit a stamped element" mark; used on tracking-state titles + pill.
  // Fill-based (unlike the lucide icons below); inherits its color from CSS via currentColor.
  edit:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
    '<path d="M4.55371 13.1662H11.1482V8.59573H4.55371V13.1662ZM4.55371 6.89248H19.4462V4.55373H4.55371V6.89248ZM13.8277 22.1495C13.5872 22.1495 13.3851 22.0676 13.2215 21.904C13.0578 21.7403 12.976 21.5382 12.976 21.2977V19.6635C12.976 19.4253 13.0215 19.2005 13.1125 18.989C13.2035 18.7773 13.326 18.5941 13.48 18.4392L18.5185 13.4305C18.6813 13.2663 18.8595 13.1486 19.0532 13.0772C19.2469 13.0057 19.4427 12.97 19.6407 12.97C19.8487 12.97 20.0505 13.0105 20.246 13.0915C20.4415 13.1725 20.618 13.292 20.7755 13.45L21.7005 14.375C21.8578 14.533 21.973 14.709 22.046 14.903C22.119 15.0968 22.1555 15.2907 22.1555 15.4847C22.1555 15.6841 22.115 15.8846 22.034 16.0862C21.953 16.2877 21.832 16.4693 21.6712 16.631L16.6865 21.6397C16.5315 21.7932 16.3474 21.9166 16.1342 22.0097C15.9212 22.1029 15.6971 22.1495 15.462 22.1495H13.8277ZM4.55371 21.1495C4.09371 21.1495 3.69488 20.9806 3.35721 20.6427C3.01938 20.3051 2.85046 19.9062 2.85046 19.4462V4.55373C2.85046 4.09207 3.01938 3.69181 3.35721 3.35298C3.69488 3.01398 4.09371 2.84448 4.55371 2.84448H19.4462C19.9079 2.84448 20.3081 3.01398 20.647 3.35298C20.986 3.69181 21.1555 4.09207 21.1555 4.55373V10.4115C21.1555 10.6518 21.072 10.8538 20.9052 11.0175C20.7382 11.1811 20.5341 11.263 20.293 11.263C20.0516 11.263 19.8501 11.1811 19.6885 11.0175C19.527 10.8538 19.4462 10.6518 19.4462 10.4115V8.59573H12.8517V13.1662H15.1505C15.3441 13.1662 15.4775 13.2574 15.5507 13.4397C15.6237 13.6219 15.594 13.7773 15.4615 13.906L11.888 17.4542C11.7555 17.5869 11.599 17.6197 11.4187 17.5527C11.2384 17.4857 11.1482 17.3576 11.1482 17.1685V14.8755H4.55371V19.4462H10.2967C10.537 19.4462 10.739 19.5285 10.9027 19.693C11.0664 19.8575 11.1482 20.0606 11.1482 20.3022C11.1482 20.5439 11.0664 20.7455 10.9027 20.907C10.739 21.0686 10.537 21.1495 10.2967 21.1495H4.55371ZM14.5657 20.5597H15.5157L18.5227 17.529L17.5977 16.6027L14.5657 19.6082V20.5597ZM18.0727 17.0527L17.5977 16.6027L18.5227 17.5277L18.0727 17.0527Z"/>' +
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
  // close — shown on the pill when the panel is open (replaces the table-edit mark via CSS).
  // Sourced from the project's own close.svg; both fill and stroke flow from currentColor.
  close:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">' +
    '<path d="M17.5996 5.92505C17.7639 5.92505 17.8659 5.97355 17.9463 6.05396C18.0265 6.13426 18.0751 6.23575 18.0752 6.39966C18.0752 6.56386 18.0266 6.66595 17.9463 6.74634L12.6924 12.0002L13.0459 12.3538L17.9463 17.2532C18.0267 17.3335 18.0752 17.4357 18.0752 17.5999C18.0752 17.7641 18.0267 17.8661 17.9463 17.9465C17.8659 18.0269 17.7639 18.0754 17.5996 18.0754C17.4355 18.0754 17.3333 18.0269 17.2529 17.9465L12.3535 13.0461L12 12.6926L6.74609 17.9465C6.66571 18.0269 6.56362 18.0754 6.39941 18.0754C6.23551 18.0754 6.13402 18.0268 6.05371 17.9465C5.97331 17.8661 5.9248 17.7641 5.9248 17.5999C5.92484 17.4357 5.97334 17.3335 6.05371 17.2532L11.3066 12.0002L10.9531 11.6467L6.05371 6.74634C5.97331 6.66594 5.9248 6.56393 5.9248 6.39966C5.92488 6.23562 5.97337 6.13429 6.05371 6.05396C6.13405 5.97362 6.23537 5.92513 6.39941 5.92505C6.56368 5.92505 6.66569 5.97355 6.74609 6.05396L11.6465 10.9534L12 11.3069L17.2529 6.05396C17.3333 5.97358 17.4355 5.92509 17.5996 5.92505Z"/>' +
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

  // Pill: icon-only round button. Carries BOTH the table-edit and close glyphs simultaneously
  // — CSS `:has(.shiage-panel:not([hidden]))` on the root toggles which one is shown based on
  // panel visibility, so the icon swap is driven entirely by the panel's `hidden` attribute
  // (no JS reactivity needed; every place that mutates panel.hidden flows through correctly).
  // A count badge (top-right) appears when there are unsaved tracked changes. The WS connection
  // state is intentionally NOT surfaced on the pill — the dot indicator was dropped per the
  // refined design; `setConnection` remains a no-op on this controller so mount.ts can keep
  // calling it without coupling to an absent UI element.
  const pillIconClosed = iconSpan('edit', 'shiage-pill__icon shiage-pill__icon--closed')
  const pillIconOpen = iconSpan('close', 'shiage-pill__icon shiage-pill__icon--open')
  const pillBadge = el('span', 'shiage-pill__badge')
  pillBadge.hidden = true
  const pill = el('button', 'shiage-pill')
  pill.type = 'button'
  pill.setAttribute('aria-label', 'Shiage')
  pill.title = 'Shiage'
  pill.append(pillIconClosed, pillIconOpen, pillBadge)
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
  // response, and for tracking *the moment a save's worth of changes first shows up* — i.e. the
  // 0→>0 edge, not every subsequent re-render. Without this guard, a user who explicitly
  // collapses the panel after one batch would have it pop back open on the very next tracker tick
  // (and the "default - with changes" Figma state — panel closed, badge visible — would be
  // unreachable in practice).
  let lastTrackingIncludedCount = 0
  return {
    render(view) {
      renderBody(view)
      const trackingTransitionedToNonZero =
        view.kind === 'tracking' &&
        view.includedCount > 0 &&
        lastTrackingIncludedCount === 0
      const autoOpen =
        view.kind === 'saving' ||
        view.kind === 'preview' ||
        view.kind === 'no-edit' ||
        view.kind === 'applied' ||
        view.kind === 'error' ||
        trackingTransitionedToNonZero
      if (autoOpen) panel.hidden = false
      // Track tracking's count for next-render edge detection. Non-tracking views reset the edge
      // anchor so a return to tracking-with-changes auto-opens again (e.g. after `applied`).
      lastTrackingIncludedCount = view.kind === 'tracking' ? view.includedCount : 0
    },
    setConnection() {
      // No-op: the refined design removes the on-pill connection dot. The Panel interface keeps
      // this method (with its `status` parameter declared on the type) so mount.ts's ws-client
      // wiring stays unchanged; a future redesign can surface the status via a different
      // affordance without churning the orchestrator.
    },
    open() {
      panel.hidden = false
    },
    destroy() {
      root.remove()
    },
  }
}
