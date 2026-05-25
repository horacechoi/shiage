// Renders the SourceDiff the server computed (Phase 5's buildSourceDiff) into DOM for the review
// panel. The diff is line-structured already, so this is pure presentation: a file header plus one
// row per line with a +/-/space gutter. Line text is set via textContent — never innerHTML — since
// it's source code from disk and must not be interpreted as markup.
import type { SourceDiff } from '@shiage/core/protocol'

export function renderDiff(diff: SourceDiff): HTMLElement {
  const container = document.createElement('div')
  container.className = 'shiage-diff'

  const file = document.createElement('div')
  file.className = 'shiage-diff__file'
  file.textContent = diff.filePath
  container.appendChild(file)

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      const row = document.createElement('div')
      row.className = `shiage-diff__line shiage-diff__line--${line.kind}`

      const gutter = document.createElement('span')
      gutter.className = 'shiage-diff__gutter'
      gutter.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '

      const text = document.createElement('span')
      text.className = 'shiage-diff__text'
      text.textContent = line.text

      row.append(gutter, text)
      container.appendChild(row)
    }
  }

  return container
}
