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

// Inline SVG (all glyphs are the project's own designs supplied directly via the desktop SVGs;
// previously some were lucide stand-ins). Rendered via innerHTML on a span — strings are all
// owned by the runtime; no user content is interpolated, so XSS is a non-issue. Every icon uses
// currentColor for its fill/stroke so the parent's CSS color drives the rendering — that lets
// the title-icon stay neutral white by default but flip to red in the error variant, etc. The
// trash icon is still the lucide trash-2 (MIT) since the design didn't supply a replacement.
const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

const ICONS = {
  // table-edit — the Shiage "edit a stamped element" mark; used on tracking-state titles + pill.
  // Fill-based (unlike the stroke icons below); inherits its color from CSS via currentColor.
  edit:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
    '<path d="M4.55371 13.1662H11.1482V8.59573H4.55371V13.1662ZM4.55371 6.89248H19.4462V4.55373H4.55371V6.89248ZM13.8277 22.1495C13.5872 22.1495 13.3851 22.0676 13.2215 21.904C13.0578 21.7403 12.976 21.5382 12.976 21.2977V19.6635C12.976 19.4253 13.0215 19.2005 13.1125 18.989C13.2035 18.7773 13.326 18.5941 13.48 18.4392L18.5185 13.4305C18.6813 13.2663 18.8595 13.1486 19.0532 13.0772C19.2469 13.0057 19.4427 12.97 19.6407 12.97C19.8487 12.97 20.0505 13.0105 20.246 13.0915C20.4415 13.1725 20.618 13.292 20.7755 13.45L21.7005 14.375C21.8578 14.533 21.973 14.709 22.046 14.903C22.119 15.0968 22.1555 15.2907 22.1555 15.4847C22.1555 15.6841 22.115 15.8846 22.034 16.0862C21.953 16.2877 21.832 16.4693 21.6712 16.631L16.6865 21.6397C16.5315 21.7932 16.3474 21.9166 16.1342 22.0097C15.9212 22.1029 15.6971 22.1495 15.462 22.1495H13.8277ZM4.55371 21.1495C4.09371 21.1495 3.69488 20.9806 3.35721 20.6427C3.01938 20.3051 2.85046 19.9062 2.85046 19.4462V4.55373C2.85046 4.09207 3.01938 3.69181 3.35721 3.35298C3.69488 3.01398 4.09371 2.84448 4.55371 2.84448H19.4462C19.9079 2.84448 20.3081 3.01398 20.647 3.35298C20.986 3.69181 21.1555 4.09207 21.1555 4.55373V10.4115C21.1555 10.6518 21.072 10.8538 20.9052 11.0175C20.7382 11.1811 20.5341 11.263 20.293 11.263C20.0516 11.263 19.8501 11.1811 19.6885 11.0175C19.527 10.8538 19.4462 10.6518 19.4462 10.4115V8.59573H12.8517V13.1662H15.1505C15.3441 13.1662 15.4775 13.2574 15.5507 13.4397C15.6237 13.6219 15.594 13.7773 15.4615 13.906L11.888 17.4542C11.7555 17.5869 11.599 17.6197 11.4187 17.5527C11.2384 17.4857 11.1482 17.3576 11.1482 17.1685V14.8755H4.55371V19.4462H10.2967C10.537 19.4462 10.739 19.5285 10.9027 19.693C11.0664 19.8575 11.1482 20.0606 11.1482 20.3022C11.1482 20.5439 11.0664 20.7455 10.9027 20.907C10.739 21.0686 10.537 21.1495 10.2967 21.1495H4.55371ZM14.5657 20.5597H15.5157L18.5227 17.529L17.5977 16.6027L14.5657 19.6082V20.5597ZM18.0727 17.0527L17.5977 16.6027L18.5227 17.5277L18.0727 17.0527Z"/>' +
    '</svg>',
  // save — saving + preview titles. Project SVG (fill-based, single complex path).
  save:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
    '<path d="M4.55371 21.1495C4.09371 21.1495 3.69488 20.9806 3.35721 20.6427C3.01938 20.3051 2.85046 19.9062 2.85046 19.4462V4.55373C2.85046 4.09207 3.01938 3.69181 3.35721 3.35298C3.69488 3.01398 4.09371 2.84448 4.55371 2.84448H16.426C16.6618 2.84448 16.8865 2.89215 17.1002 2.98748C17.3139 3.08282 17.4973 3.20706 17.6505 3.36023L20.6397 6.34948C20.7929 6.50265 20.9171 6.68606 21.0125 6.89973C21.1078 7.1134 21.1555 7.33815 21.1555 7.57398V19.4462C21.1555 19.9062 20.986 20.3051 20.647 20.6427C20.3081 20.9806 19.9079 21.1495 19.4462 21.1495H4.55371ZM19.4462 7.62398L16.376 4.55373H4.55371V19.4462H19.4462V7.62398ZM11.994 17.8212C12.7146 17.8212 13.3291 17.569 13.8375 17.0645C14.3458 16.5601 14.6 15.9476 14.6 15.227C14.6 14.5065 14.3478 13.8921 13.8435 13.3837C13.339 12.8754 12.7265 12.6212 12.006 12.6212C11.2853 12.6212 10.6708 12.8734 10.1625 13.3777C9.65413 13.8822 9.39996 14.4947 9.39996 15.2152C9.39996 15.9359 9.65213 16.5504 10.1565 17.0587C10.661 17.5671 11.2735 17.8212 11.994 17.8212ZM6.73046 9.45373H13.9772C14.2175 9.45373 14.4195 9.3719 14.5832 9.20823C14.7469 9.04457 14.8287 8.84257 14.8287 8.60223V6.73048C14.8287 6.48998 14.7469 6.2879 14.5832 6.12423C14.4195 5.96056 14.2175 5.87873 13.9772 5.87873H6.73046C6.48996 5.87873 6.28788 5.96056 6.12421 6.12423C5.96055 6.2879 5.87871 6.48998 5.87871 6.73048V8.60223C5.87871 8.84257 5.96055 9.04457 6.12421 9.20823C6.28788 9.3719 6.48996 9.45373 6.73046 9.45373ZM4.55371 7.62398V19.4462V4.55373V7.62398Z"/>' +
    '</svg>',
  // alert-triangle — no-edit title (the save produced nothing to write). Project SVG.
  warn:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5552" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M11.9998 9.55566V12.6661M11.9998 15.7764H12.0075M10.923 5.58347L4.52736 16.6305C4.17262 17.2433 3.99524 17.5496 4.02146 17.8011C4.04433 18.0204 4.15923 18.2197 4.33758 18.3494C4.54206 18.498 4.89607 18.498 5.60409 18.498H18.3954C19.1034 18.498 19.4574 18.498 19.6619 18.3494C19.8403 18.2197 19.9552 18.0204 19.978 17.8011C20.0043 17.5496 19.8269 17.2433 19.4721 16.6305L13.0765 5.58346C12.723 4.97292 12.5463 4.66765 12.3157 4.56512C12.1146 4.47569 11.8849 4.47569 11.6838 4.56512C11.4532 4.66765 11.2765 4.97292 10.923 5.58347Z"/>' +
    '</svg>',
  // check — applied title (write succeeded). Project SVG.
  check: `<svg ${SVG_ATTRS}>` + '<path d="M20 6L9 17L4 12"/>' + '</svg>',
  // alert-octagon — error title. Project SVG (stroke 1.5; currentColor flows the title-row
  // error class through so the icon goes red alongside the title text).
  error:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 9V12M12 15H12.0075M4.5 9.39206V14.6079C4.5 14.7914 4.5 14.8831 4.52072 14.9694C4.5391 15.046 4.5694 15.1191 4.61052 15.1862C4.6569 15.2619 4.72176 15.3268 4.85147 15.4565L8.54353 19.1485C8.67324 19.2782 8.7381 19.3431 8.81379 19.3895C8.88089 19.4306 8.95405 19.4609 9.03058 19.4793C9.11689 19.5 9.20861 19.5 9.39206 19.5H14.6079C14.7914 19.5 14.8831 19.5 14.9694 19.4793C15.046 19.4609 15.1191 19.4306 15.1862 19.3895C15.2619 19.3431 15.3268 19.2782 15.4565 19.1485L19.1485 15.4565C19.2782 15.3268 19.3431 15.2619 19.3895 15.1862C19.4306 15.1191 19.4609 15.046 19.4793 14.9694C19.5 14.8831 19.5 14.7914 19.5 14.6079V9.39206C19.5 9.20861 19.5 9.11689 19.4793 9.03058C19.4609 8.95405 19.4306 8.88089 19.3895 8.81379C19.3431 8.7381 19.2782 8.67324 19.1485 8.54353L15.4565 4.85147C15.3268 4.72176 15.2619 4.6569 15.1862 4.61052C15.1191 4.5694 15.046 4.5391 14.9694 4.52072C14.8831 4.5 14.7914 4.5 14.6079 4.5H9.39206C9.20861 4.5 9.11689 4.5 9.03058 4.52072C8.95405 4.5391 8.88089 4.5694 8.81379 4.61052C8.7381 4.6569 8.67324 4.72176 8.54353 4.85147L4.85147 8.54353C4.72176 8.67324 4.6569 8.7381 4.61052 8.81379C4.5694 8.88089 4.5391 8.95405 4.52072 9.03058C4.5 9.11689 4.5 9.20861 4.5 9.39206Z"/>' +
    '</svg>',
  // trash-2 — per-group Remove affordance (CSS class is still .shiage-group__remove). Lucide.
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
  // The error class lives on the title-row so both the icon and the text span inherit the
  // red color via a single CSS rule — saves us having to thread the variant through to each
  // child individually.
  const rowClass = `shiage-title-row${options?.error ? ' shiage-title-row--error' : ''}`
  const row = el('div', rowClass)
  row.append(iconSpan(icon, 'shiage-title-icon'), el('span', 'shiage-title', title))
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
        body.append(titleSection('edit', 'Shiage', 'Edit CSS in DevTools to see changes here.'))

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
        view.kind === 'tracking' && view.includedCount > 0 && lastTrackingIncludedCount === 0
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
