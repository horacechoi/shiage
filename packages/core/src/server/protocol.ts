// The framework-agnostic heart of the save flow. It owns no transport and no Tailwind detection —
// it is handed a `getContext()` (project root + the current ThemeSource and reverse-lookup) and a
// `send` callback, and turns the protocol's client messages into source edits:
//
//   save   → map changes to class edits → rewrite the className in memory → reply diff-preview
//            (staging the unwritten result) or no-edit (with a human reason)
//   apply  → write the staged result to disk → reply apply-result
//   cancel → drop the staged result
//   hello  → reply server-info
//
// `getContext` is read per message, so a config reload that swaps in a new lookup takes effect on
// the next save without rebuilding this handler. Both plugins (Vite, Next) drive it identically.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mapChangesToClassEdits } from '../mapper'
import { editJsxSource } from '../ast/edit'
import { buildSourceDiff } from '../diff'
import type { ReverseLookup } from '../tailwind/reverse-lookup'
import type { ThemeSource } from '../tailwind/types'
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type SaveMessage,
  type ServerMessage,
} from '../protocol'

/** What the save router needs from the host plugin, fetched fresh per message. */
export interface ProtocolContext {
  /** Absolute project root; stamped `relPath:line:col` locations resolve against it. */
  projectRoot: string
  themeSource: ThemeSource
  lookup: ReverseLookup
}

export interface ProtocolHandler {
  /** Route one client message, replying via `send` (zero, one, or — never, today — more frames). */
  handle(message: ClientMessage, send: (message: ServerMessage) => void): void
}

/** A previewed-but-unwritten edit, held between `save` and the user's `apply`. */
interface StagedEdit {
  absPath: string
  code: string
}

/** Build the protocol handler. `getContext` is the live source of project root + theme/lookup. */
export function wireProtocol(getContext: () => ProtocolContext): ProtocolHandler {
  const staged = new Map<string, StagedEdit>()

  return {
    handle(message, send) {
      switch (message.type) {
        case 'hello':
          send({ type: 'server-info', protocolVersion: PROTOCOL_VERSION })
          break
        case 'save':
          handleSave(message, getContext(), staged, send)
          break
        case 'apply':
          handleApply(message.saveId, staged, send)
          break
        case 'cancel':
          staged.delete(message.saveId)
          break
      }
    },
  }
}

function handleSave(
  message: SaveMessage,
  context: ProtocolContext,
  staged: Map<string, StagedEdit>,
  send: (message: ServerMessage) => void,
): void {
  const noEdit = (reason: string): void => send({ type: 'no-edit', saveId: message.saveId, reason })

  const loc = parseSourceLoc(message.sourceLoc)
  if (!loc) return noEdit(`Malformed source location "${message.sourceLoc}".`)

  const edits = mapChangesToClassEdits(
    message.changes,
    message.className,
    context.lookup,
    context.themeSource,
  )
  if (edits.add.length === 0 && edits.remove.length === 0) {
    return noEdit(
      edits.unsupported.length > 0
        ? `No Tailwind class for: ${edits.unsupported.join(', ')}.`
        : 'No changes to save.',
    )
  }

  const absPath = path.resolve(context.projectRoot, loc.relPath)
  let original: string
  try {
    original = readFileSync(absPath, 'utf8')
  } catch {
    return noEdit(`Couldn't read ${loc.relPath}.`)
  }

  const result = editJsxSource(
    original,
    absPath,
    { line: loc.line, column: loc.column },
    { add: edits.add, remove: edits.remove },
  )
  if (result.status === 'not-found') {
    return noEdit(`Couldn't find the picked element in ${loc.relPath}.`)
  }
  if (result.status === 'unsupported') return noEdit(result.reason)

  staged.set(message.saveId, { absPath, code: result.code })
  send({
    type: 'diff-preview',
    saveId: message.saveId,
    diff: buildSourceDiff(loc.relPath, original, result.code),
    warnings: [...edits.warnings, ...result.warnings],
    unsupported: edits.unsupported,
  })
}

function handleApply(
  saveId: string,
  staged: Map<string, StagedEdit>,
  send: (message: ServerMessage) => void,
): void {
  const edit = staged.get(saveId)
  if (!edit) {
    send({
      type: 'apply-result',
      saveId,
      success: false,
      error: 'This change is no longer staged — try saving again.',
    })
    return
  }
  try {
    writeFileSync(edit.absPath, edit.code, 'utf8')
    staged.delete(saveId)
    send({ type: 'apply-result', saveId, success: true })
  } catch (err) {
    send({ type: 'apply-result', saveId, success: false, error: (err as Error).message })
  }
}

/**
 * Parse a stamped `data-shiage-loc` value (`"src/App.tsx:42:9"`) into its parts. Split from the
 * right so a path containing a colon (or a Windows drive letter) can't be mistaken for the
 * line/column — only the trailing `:line:col` is ours to interpret.
 */
function parseSourceLoc(loc: string): { relPath: string; line: number; column: number } | null {
  const match = /^(.*):(\d+):(\d+)$/.exec(loc)
  if (!match || !match[1]) return null
  return { relPath: match[1], line: Number(match[2]), column: Number(match[3]) }
}
