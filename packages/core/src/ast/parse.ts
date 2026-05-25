import { parse, type ParserOptions, type ParserPlugin } from '@babel/parser'
import type { File } from '@babel/types'

// Babel parser plugins by file extension. The transform (and therefore Shiage) only ever edits
// `.tsx`/`.jsx`, but we accept the wider set defensively. `.ts` is parsed without `jsx` because
// `<T>` is a type assertion there, not an element.
function pluginsFor(filename: string): ParserPlugin[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.tsx')) return ['jsx', 'typescript']
  if (/\.[mc]?ts$/.test(lower)) return ['typescript']
  return ['jsx']
}

const PARSE_OPTIONS: Omit<ParserOptions, 'sourceFilename' | 'plugins'> = {
  sourceType: 'module',
  // We never regenerate code — nodes are mapped back to source offsets and edited in place — so
  // ranges (`node.start`/`node.end`) must be present and accurate. Babel populates them by default.
  ranges: true,
}

/**
 * Parse a JSX/TSX source string into a Babel AST. Throws on a syntax error; callers in the editor
 * treat that as an unsupported file rather than crashing the dev server.
 */
export function parseJsx(code: string, filename: string): File {
  return parse(code, { ...PARSE_OPTIONS, sourceFilename: filename, plugins: pluginsFor(filename) })
}
