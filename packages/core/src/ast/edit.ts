import { readFileSync } from 'node:fs'
import MagicString from 'magic-string'
import { parseJsx } from './parse'
import { findOpeningElementByLoc, type SourceLoc } from './find'
import { analyzeClassName, type ClassSpan } from './classname'
import { mergeClassString } from './merge'

/** The class-list delta to apply, as produced by the mapper (`ClassEdits`). */
export interface ClassNameEdits {
  add: readonly string[]
  remove: readonly string[]
}

export type EditResult =
  | { status: 'edited'; code: string; warnings: string[] }
  | { status: 'unsupported'; reason: string }
  | { status: 'not-found' }

const PARTIAL_WARNING =
  'Only the static parts of a dynamic className were edited; some changes may not fully apply.'

const tokens = (text: string): string[] => text.split(/\s+/).filter(Boolean)
const uniq = <T>(items: readonly T[]): T[] => [...new Set(items)]

/**
 * Apply a class-list delta to the `className` of the JSX element at `loc`, editing the original
 * source text in place (never regenerating it). Returns the new source on success, or why it
 * couldn't be edited. Pure over its inputs — the file-reading wrapper is `editJsxFile`.
 */
export function editJsxSource(
  code: string,
  filename: string,
  loc: SourceLoc,
  edits: ClassNameEdits,
): EditResult {
  let ast
  try {
    ast = parseJsx(code, filename)
  } catch (err) {
    return { status: 'unsupported', reason: `parse error: ${(err as Error).message}` }
  }

  const element = findOpeningElementByLoc(ast, loc)
  if (!element) return { status: 'not-found' }

  const analysis = analyzeClassName(element)
  if (analysis.kind === 'unsupported') return { status: 'unsupported', reason: analysis.reason }

  const s = new MagicString(code)
  const warnings: string[] = []
  const { add, remove } = edits

  switch (analysis.kind) {
    case 'absent': {
      const merged = mergeClassString('', add, remove)
      if (merged.length > 0) s.appendLeft(analysis.insertAt, ` className="${merged}"`)
      break
    }
    case 'spans': {
      applySpanEdits(s, analysis.spans, add, remove)
      if (analysis.partial) warnings.push(PARTIAL_WARNING)
      break
    }
    case 'template': {
      // Edit each quasi without disturbing the whitespace that abuts its `${…}` interpolations;
      // additions fold into the last static quasi so they land after the existing classes.
      const additions = newAdditions(add, analysis.quasis)
      analysis.quasis.forEach((quasi, i) => {
        const append = i === analysis.quasis.length - 1 ? additions : []
        const rebuilt = rebuildQuasi(quasi.text, remove, append)
        if (rebuilt !== quasi.text) replaceSpan(s, quasi, rebuilt)
      })
      warnings.push(PARTIAL_WARNING)
      break
    }
    case 'insert-arg': {
      const merged = mergeClassString('', add, remove)
      if (merged.length > 0) {
        s.appendLeft(analysis.at, analysis.trailing ? `'${merged}', ` : `'${merged}'`)
      }
      warnings.push(PARTIAL_WARNING)
      break
    }
  }

  return { status: 'edited', code: s.toString(), warnings }
}

/** Read the file and edit it. Returns `not-found` if the file can't be read. */
export function editJsxFile(filePath: string, loc: SourceLoc, edits: ClassNameEdits): EditResult {
  let code: string
  try {
    code = readFileSync(filePath, 'utf8')
  } catch {
    return { status: 'not-found' }
  }
  return editJsxSource(code, filePath, loc, edits)
}

// Additions go to the first span only; removals to every span. Additions already present anywhere
// in the className (across all spans) are skipped so we never duplicate a class.
function applySpanEdits(
  s: MagicString,
  spans: ClassSpan[],
  add: readonly string[],
  remove: readonly string[],
): void {
  const additions = newAdditions(add, spans)
  spans.forEach((span, i) => {
    const merged = mergeClassString(span.text, i === 0 ? additions : [], remove)
    if (merged !== span.text) replaceSpan(s, span, merged)
  })
}

// Tokens in `add` not already present in any of the given spans, de-duplicated.
function newAdditions(add: readonly string[], spans: ClassSpan[]): string[] {
  const present = new Set<string>()
  for (const span of spans) for (const tok of tokens(span.text)) present.add(tok)
  return uniq(add).filter((tok) => !present.has(tok))
}

// Rebuild a template quasi: drop removed tokens, optionally append additions, but keep the
// leading/trailing whitespace that separates the static text from an adjacent `${…}` — collapsing
// it would glue a class to an interpolated value.
function rebuildQuasi(text: string, remove: readonly string[], append: readonly string[]): string {
  const lead = /^\s*/.exec(text)![0]
  const trail = /\s*$/.exec(text)![0]
  const core = text.slice(lead.length, text.length - trail.length)
  const removeSet = new Set(remove)
  const kept =
    core.length > 0 ? core.split(/\s+/).filter((t) => t.length > 0 && !removeSet.has(t)) : []
  for (const tok of append) if (!kept.includes(tok)) kept.push(tok)

  if (kept.length === 0) return lead === text ? text : lead + trail // all-whitespace, or emptied
  // Preserve original leading whitespace; if there was none but the quasi began empty (it abuts an
  // interpolation), insert one space so an appended class doesn't glue onto `${…}`.
  const head = lead.length > 0 ? lead : core.length === 0 && append.length > 0 ? ' ' : ''
  return head + kept.join(' ') + trail
}

function replaceSpan(s: MagicString, span: ClassSpan, text: string): void {
  if (span.start === span.end) {
    if (text.length > 0) s.appendLeft(span.start, text)
  } else {
    s.update(span.start, span.end, text)
  }
}
