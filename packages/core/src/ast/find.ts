import { VISITOR_KEYS } from '@babel/types'
import type { File, JSXOpeningElement, Node } from '@babel/types'

/**
 * A source location as carried by a `data-shiage-loc` stamp (see `@shiage/jsx-transform`).
 *
 * **Convention (pinned once):** the stamp's line and column are both **1-based**. Babel reports
 * `loc.start.line` 1-based but `loc.start.column` **0-based**, so we subtract one from `column`
 * before matching. The transform adds one when it stamps; these two halves must stay in sync.
 */
export interface SourceLoc {
  /** 1-based line. */
  line: number
  /** 1-based column. */
  column: number
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
}

// Depth-first search using Babel's own per-type child-key map — avoids depending on @babel/traverse
// (and its CJS/ESM interop), and short-circuits as soon as the predicate matches.
function findFirst(node: Node, match: (n: Node) => boolean): Node | undefined {
  if (match(node)) return node
  const keys = VISITOR_KEYS[node.type]
  if (!keys) return undefined
  const record = node as unknown as Record<string, unknown>
  for (const key of keys) {
    const child = record[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isNode(item)) {
          const found = findFirst(item, match)
          if (found) return found
        }
      }
    } else if (isNode(child)) {
      const found = findFirst(child, match)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Find the `JSXOpeningElement` whose start position matches a stamped location, or `undefined` if
 * the source no longer has an element exactly there (e.g. it moved since the stamp was emitted).
 */
export function findOpeningElementByLoc(ast: File, loc: SourceLoc): JSXOpeningElement | undefined {
  const column = loc.column - 1 // 1-based stamp → 0-based Babel column
  const node = findFirst(
    ast,
    (n) =>
      n.type === 'JSXOpeningElement' &&
      n.loc != null &&
      n.loc.start.line === loc.line &&
      n.loc.start.column === column,
  )
  return node as JSXOpeningElement | undefined
}
