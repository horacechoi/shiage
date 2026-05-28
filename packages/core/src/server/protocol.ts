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
  type SourceDiff,
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

/** One file's previewed-but-unwritten content, held between `save` and the user's `apply`. A batch
 * save may stage several of these — one per touched file — under a single saveId. */
interface StagedFile {
  absPath: string
  code: string
}

/** Build the protocol handler. `getContext` is the live source of project root + theme/lookup. */
export function wireProtocol(getContext: () => ProtocolContext): ProtocolHandler {
  const staged = new Map<string, StagedFile[]>()

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

/** A batch save can carry edits for many elements across many files. We group by file so each file
 * is read exactly once, then thread the rewritten `code` through successive `editJsxSource` calls
 * within the file — this is required for correctness: two elements sharing a file (the card's
 * heading and button, say) would otherwise each be staged as a from-original edit, and the second
 * apply would clobber the first. Per-element failure is non-fatal: a missing loc or unsupported
 * className shape is reported as a warning and the batch carries on. Only when *nothing* across
 * the whole batch was writable do we reply `no-edit`. */
function handleSave(
  message: SaveMessage,
  context: ProtocolContext,
  staged: Map<string, StagedFile[]>,
  send: (message: ServerMessage) => void,
): void {
  const noEdit = (reason: string): void => send({ type: 'no-edit', saveId: message.saveId, reason })
  const warnings: string[] = []
  const unsupported: string[] = []

  // 1. Group every parsable edit by its absolute file path, preserving each one's loc.
  interface PendingItem {
    loc: { line: number; column: number }
    edit: SaveMessage['edits'][number]
  }
  interface PendingFile {
    relPath: string
    absPath: string
    items: PendingItem[]
  }
  const byFile = new Map<string, PendingFile>()
  for (const edit of message.edits) {
    const loc = parseSourceLoc(edit.sourceLoc)
    if (!loc) {
      warnings.push(`Malformed source location "${edit.sourceLoc}".`)
      continue
    }
    const absPath = path.resolve(context.projectRoot, loc.relPath)
    const group = byFile.get(absPath) ?? { relPath: loc.relPath, absPath, items: [] }
    group.items.push({ loc: { line: loc.line, column: loc.column }, edit })
    byFile.set(absPath, group)
  }

  const diffs: SourceDiff[] = []
  const stagedFiles: StagedFile[] = []

  // 2. Per file: read once, thread `code` through each element's edit. Sort by source position so
  // the apply order is deterministic and predictable in logs/warnings (single-line className
  // rewrites via magic-string don't move other elements' line/columns, so successive loc lookups
  // against the threaded `code` remain valid).
  for (const { relPath, absPath, items } of byFile.values()) {
    let original: string
    try {
      original = readFileSync(absPath, 'utf8')
    } catch {
      warnings.push(`Couldn't read ${relPath}.`)
      continue
    }
    items.sort((a, b) => a.loc.line - b.loc.line || a.loc.column - b.loc.column)

    let code = original
    let anyApplied = false
    for (const { loc, edit } of items) {
      const mapped = mapChangesToClassEdits(
        edit.changes,
        edit.className,
        context.lookup,
        context.themeSource,
      )
      warnings.push(...mapped.warnings)
      unsupported.push(...mapped.unsupported)
      if (mapped.add.length === 0 && mapped.remove.length === 0) continue

      const result = editJsxSource(code, absPath, loc, { add: mapped.add, remove: mapped.remove })
      if (result.status === 'edited') {
        code = result.code
        warnings.push(...result.warnings)
        anyApplied = true
      } else if (result.status === 'unsupported') {
        warnings.push(`${relPath} @ ${edit.sourceLoc}: ${result.reason}`)
      } else {
        warnings.push(`Couldn't find the element at ${edit.sourceLoc} in ${relPath}.`)
      }
    }

    if (anyApplied && code !== original) {
      stagedFiles.push({ absPath, code })
      diffs.push(buildSourceDiff(relPath, original, code))
    }
  }

  // 3. Only `no-edit` when nothing anywhere in the batch was writable — never abort mid-batch.
  // Surface the most actionable reason we have: unsupported properties first (the mapper couldn't
  // produce a class for them), then the first per-element warning (e.g. "couldn't find" — useful
  // when a single edit failed), with a generic fallback for the truly empty case.
  if (stagedFiles.length === 0) {
    const reasons = [...new Set(unsupported)]
    if (reasons.length > 0) return noEdit(`No Tailwind class for: ${reasons.join(', ')}.`)
    if (warnings.length > 0) return noEdit(warnings[0]!)
    return noEdit('No changes to save.')
  }

  staged.set(message.saveId, stagedFiles)
  send({
    type: 'diff-preview',
    saveId: message.saveId,
    diffs,
    warnings,
    unsupported: [...new Set(unsupported)],
  })
}

function handleApply(
  saveId: string,
  staged: Map<string, StagedFile[]>,
  send: (message: ServerMessage) => void,
): void {
  const files = staged.get(saveId)
  if (!files) {
    send({
      type: 'apply-result',
      saveId,
      success: false,
      error: 'This change is no longer staged — try saving again.',
    })
    return
  }
  try {
    // Multi-file write is best-effort sequential: if file N throws after file N-1 wrote, the disk
    // is left in a partial state and the user re-saves. The transactional alternative (write to a
    // tempdir then rename) buys little for a dev-only tool and complicates rollback. Note this as
    // an accepted v1 limitation.
    for (const file of files) writeFileSync(file.absPath, file.code, 'utf8')
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
