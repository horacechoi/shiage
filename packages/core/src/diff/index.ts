// Builds the SourceDiff the runtime renders in the review panel, from the before/after text of the
// file the AST editor produced. We delegate the line math to the `diff` package's structuredPatch
// (the same hunk model `git diff` uses) and translate its prefixed lines into the protocol's
// structured DiffLine shape so the browser never has to parse a patch string.
import { structuredPatch } from 'diff'
import type { DiffHunk, DiffLine, SourceDiff } from '../protocol'

/** Lines of surrounding context to include around each change (matches git's default). */
const CONTEXT_LINES = 3

/**
 * Diff the original file text against the edited text and return a structured SourceDiff. `filePath`
 * is carried through verbatim for the panel header (expected to be project-relative). An empty
 * `hunks` array means the texts were identical.
 */
export function buildSourceDiff(filePath: string, oldCode: string, newCode: string): SourceDiff {
  const patch = structuredPatch(filePath, filePath, oldCode, newCode, '', '', {
    context: CONTEXT_LINES,
  })
  const hunks: DiffHunk[] = patch.hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    lines: hunk.lines.map(toDiffLine).filter((line): line is DiffLine => line !== null),
  }))
  return { filePath, hunks }
}

// structuredPatch prefixes each line with its kind: '+' added, '-' removed, ' ' context. A line
// beginning with '\' is the "\ No newline at end of file" marker — metadata, not content, so we
// drop it (returning null) rather than render it as a code line.
function toDiffLine(raw: string): DiffLine | null {
  const text = raw.slice(1)
  switch (raw[0]) {
    case '+':
      return { kind: 'add', text }
    case '-':
      return { kind: 'del', text }
    case '\\':
      return null
    default:
      return { kind: 'context', text }
  }
}
