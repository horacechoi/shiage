// Pick mode: the user clicks an element to select it for editing. We listen on the document in the
// *capture* phase so we see the click before any app handler, and swallow it (preventDefault +
// stopPropagation) so picking a link or button doesn't also trigger the app. On click we resolve
// the clicked node's nearest `data-shiage-loc` ancestor — the stamp the JSX transform put on the
// host element — which tells the server which source element to edit. Esc cancels.
//
// Our own overlay nodes (the panel, the highlight) are skipped via `isOwnElement`, which the caller
// implements as a `closest('[data-shiage-host]')` check.

/** The attribute the JSX transform stamps on host elements: `"relPath:line:col"`. */
const SOURCE_LOC_ATTR = 'data-shiage-loc'

export interface PickResult {
  /** The element actually clicked. */
  element: Element
  /** The nearest ancestor (or self) carrying `data-shiage-loc`, if any. */
  matchedElement: Element | null
  /** That ancestor's `data-shiage-loc` value, or null if the click had no stamped ancestor. */
  sourceLoc: string | null
}

export interface PickerOptions {
  /** Document to listen on. Defaults to the ambient `document`. */
  doc?: Document
  /** True for the overlay's own nodes, which pick mode must ignore. */
  isOwnElement: (element: Element) => boolean
  /** Called as the cursor moves over a pickable element (null over our own UI / nothing). */
  onHover: (element: Element | null) => void
  /** Called once when the user clicks a pickable element. Pick mode stops automatically after. */
  onPick: (result: PickResult) => void
  /** Called when the user presses Esc. Pick mode stops automatically after. */
  onCancel: () => void
}

/** Enter pick mode. Returns a function that exits it (also called automatically on pick/cancel). */
export function startPicking(options: PickerOptions): () => void {
  const doc = options.doc ?? document

  const targetOf = (event: Event): Element | null => {
    const target = event.target
    return target instanceof Element ? target : null
  }

  const onMouseMove = (event: Event): void => {
    const target = targetOf(event)
    options.onHover(target && !options.isOwnElement(target) ? target : null)
  }

  const onClick = (event: MouseEvent): void => {
    const target = targetOf(event)
    if (!target || options.isOwnElement(target)) return
    // Swallow the click so picking doesn't also activate the app's own handler / navigation.
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const matchedElement = target.closest(`[${SOURCE_LOC_ATTR}]`)
    stop()
    options.onPick({
      element: target,
      matchedElement,
      sourceLoc: matchedElement?.getAttribute(SOURCE_LOC_ATTR) ?? null,
    })
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    stop()
    options.onCancel()
  }

  function stop(): void {
    doc.removeEventListener('mousemove', onMouseMove, true)
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('keydown', onKeyDown, true)
  }

  doc.addEventListener('mousemove', onMouseMove, true)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('keydown', onKeyDown, true)
  return stop
}
