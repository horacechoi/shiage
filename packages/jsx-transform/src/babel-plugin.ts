import { relative, sep } from 'node:path'
import type { NodePath, PluginObj, PluginPass } from '@babel/core'
import type * as BabelTypes from '@babel/types'

export interface ShiageStampOptions {
  /**
   * Absolute path that stamped locations are made relative to. Relative paths keep the stamp
   * portable and avoid leaking a developer's absolute filesystem layout into the DOM. Defaults to
   * Babel's resolved project root, then `process.cwd()`.
   */
  projectRoot?: string
  /** When `false`, the plugin does nothing — production builds leave no stamps. Default `true`. */
  enabled?: boolean
}

/** The attribute the runtime reads to resolve a picked element back to its source location. */
export const STAMP_ATTRIBUTE = 'data-shiage-loc'

// The minimal slice of the Babel plugin API we rely on (the `types` builders + a version guard).
interface BabelApi {
  assertVersion(range: number | string): void
  types: typeof BabelTypes
}

function alreadyStamped(node: BabelTypes.JSXOpeningElement): boolean {
  return node.attributes.some(
    (attr) =>
      attr.type === 'JSXAttribute' &&
      attr.name.type === 'JSXIdentifier' &&
      attr.name.name === STAMP_ATTRIBUTE,
  )
}

// A lowercase-initial JSX tag is a host (DOM) element; uppercase is a component, and member or
// namespaced names (`<Foo.Bar>`, `<svg:rect>`) are never host elements. Only host elements render
// to real DOM nodes the runtime can pick, so only they are worth stamping.
function isHostElement(
  name: BabelTypes.JSXOpeningElement['name'],
): name is BabelTypes.JSXIdentifier {
  return name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name)
}

function toRelativePosix(root: string, filename: string): string {
  return relative(root, filename).split(sep).join('/')
}

/**
 * Babel plugin that stamps `data-shiage-loc="<relPath>:<line>:<col>"` onto every lowercase host
 * element, so the browser runtime can map a picked DOM node back to its JSX source location.
 *
 * **Column convention (pinned, see `@shiage/core`'s `find`):** `line` is Babel's 1-based line and
 * `col` is Babel's 0-based column **plus one**, i.e. both are 1-based. The editor subtracts one.
 *
 * Must run before the JSX-to-`createElement` transform — once JSX is compiled away there is no
 * `JSXOpeningElement` to visit.
 */
export default function shiageStampPlugin(api: BabelApi): PluginObj<PluginPass> {
  api.assertVersion(7)
  const t = api.types

  return {
    name: 'shiage-stamp-loc',
    visitor: {
      JSXOpeningElement(path: NodePath<BabelTypes.JSXOpeningElement>, state: PluginPass) {
        const opts = state.opts as ShiageStampOptions
        if (opts.enabled === false) return

        const node = path.node
        if (!isHostElement(node.name) || !node.loc || alreadyStamped(node)) return

        const filename = state.file.opts.filename
        if (!filename) return // no path to stamp; skip rather than emit a meaningless location

        const root = opts.projectRoot ?? state.file.opts.root ?? process.cwd()
        const relPath = toRelativePosix(root, filename)
        const value = `${relPath}:${node.loc.start.line}:${node.loc.start.column + 1}`

        node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier(STAMP_ATTRIBUTE), t.stringLiteral(value)),
        )
      },
    },
  }
}
