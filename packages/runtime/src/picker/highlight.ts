// A single outline box that tracks the hovered element during pick mode. It lives inside the
// overlay's Shadow DOM (so page CSS can't restyle it) on its own `position: fixed` layer with
// `pointer-events: none`, and is positioned from the target's getBoundingClientRect — viewport
// coordinates, matching `fixed`. Styling comes from the `.shiage-highlight` rule in styles.ts.

export interface Highlight {
  /** Move the outline over `element` and show it. */
  show(element: Element): void
  /** Hide the outline. */
  hide(): void
  /** Remove the outline element. */
  destroy(): void
}

export function createHighlight(parent: ParentNode & Node): Highlight {
  const box = document.createElement('div')
  box.className = 'shiage-highlight'
  box.style.display = 'none'
  parent.appendChild(box)

  return {
    show(element) {
      const rect = element.getBoundingClientRect()
      box.style.display = 'block'
      box.style.top = `${rect.top}px`
      box.style.left = `${rect.left}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
    },
    hide() {
      box.style.display = 'none'
    },
    destroy() {
      box.remove()
    },
  }
}
