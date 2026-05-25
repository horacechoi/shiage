import { VISITOR_KEYS, type JSXOpeningElement, type Node } from '@babel/types'
import { parseJsx } from '../src/ast/parse'
import type { SourceLoc } from '../src/ast/find'

/** The element's tag name when it's a plain host element (lowercase or component identifier). */
export function tagName(el: JSXOpeningElement | undefined): string | undefined {
  return el && el.name.type === 'JSXIdentifier' ? el.name.name : undefined
}

const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && typeof (v as Node).type === 'string'

/**
 * Locate the nth `<tag>` opening element and the `data-shiage-loc` stamp it would carry. This
 * mirrors what `@shiage/jsx-transform` does — take Babel's loc and make the column 1-based — so
 * tests exercise the real stamp→find round-trip rather than hand-counted columns.
 */
export function findElement(
  code: string,
  tag: string,
  nth = 0,
): { el: JSXOpeningElement; loc: SourceLoc } {
  const ast = parseJsx(code, 'Test.tsx')
  let count = 0
  let match: JSXOpeningElement | undefined
  const visit = (node: Node): void => {
    if (match) return
    if (node.type === 'JSXOpeningElement' && tagName(node) === tag) {
      if (count === nth) match = node
      count += 1
    }
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(child)) child.forEach((c) => isNode(c) && visit(c))
      else if (isNode(child)) visit(child)
    }
  }
  visit(ast)
  if (!match || !match.loc) throw new Error(`no <${tag}> #${nth} in source`)
  return { el: match, loc: { line: match.loc.start.line, column: match.loc.start.column + 1 } }
}

export const stampLocOf = (code: string, tag: string, nth = 0): SourceLoc =>
  findElement(code, tag, nth).loc
