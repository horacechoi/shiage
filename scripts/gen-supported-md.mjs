// Generates SUPPORTED_PROPERTIES.md from @shiage/core's SUPPORTED_PROPERTIES constant, so the
// human-readable doc is always in sync with the code. Run with `pnpm gen:supported` (after build).
import { writeFileSync } from 'node:fs'
import { SUPPORTED_PROPERTIES } from '../packages/core/dist/index.js'

const CATEGORIES = ['Spacing', 'Sizing', 'Typography', 'Background', 'Border', 'Effects']

function categoryOf(property, meta) {
  if (property === 'color') return 'Typography'
  if (property === 'background-color') return 'Background'
  if (property.startsWith('border')) return 'Border'
  if (property === 'opacity' || property === 'box-shadow') return 'Effects'
  if (meta.namespace === 'spacing') return 'Spacing'
  if (
    ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign'].includes(meta.namespace)
  )
    return 'Typography'
  return 'Sizing'
}

const byCategory = new Map(CATEGORIES.map((c) => [c, []]))
for (const [property, meta] of Object.entries(SUPPORTED_PROPERTIES)) {
  byCategory.get(categoryOf(property, meta)).push({ property, meta })
}

let md = `# Supported CSS properties (v1)

> **Generated from \`packages/core/src/supported.ts\` — do not edit by hand.** Run \`pnpm gen:supported\`.

Shiage maps changes to these CSS properties back to Tailwind classes. The browser runtime only
flags changes to these properties; anything else shows a "not supported in v1, edit your code
directly" message.

Shiage assumes the default **16px root font size** when matching Tailwind's rem-based scales. If
you've changed \`html { font-size }\`, exact matches may fall back to arbitrary px values.

| Category | CSS property | Match type |
| --- | --- | --- |
`

for (const category of CATEGORIES) {
  const rows = byCategory.get(category)
  rows.sort((a, b) => a.property.localeCompare(b.property))
  for (const { property, meta } of rows) {
    md += `| ${category} | \`${property}\` | ${meta.kind} |\n`
  }
}

md += `\nTotal: ${Object.keys(SUPPORTED_PROPERTIES).length} properties.\n`

writeFileSync(new URL('../SUPPORTED_PROPERTIES.md', import.meta.url), md)
console.log('Wrote SUPPORTED_PROPERTIES.md')
