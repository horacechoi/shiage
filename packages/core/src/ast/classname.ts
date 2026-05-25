import type {
  CallExpression,
  JSXAttribute,
  JSXExpressionContainer,
  JSXOpeningElement,
  StringLiteral,
  TemplateElement,
  TemplateLiteral,
} from '@babel/types'

/** A contiguous run of source (exclusive `end`) holding a plain, space-separated class string. */
export interface ClassSpan {
  /** Offset of the first editable character (inside the quotes / template delimiters). */
  start: number
  /** Offset just past the last editable character. May equal `start` for an empty literal. */
  end: number
  /** The current text occupying `[start, end)`. */
  text: string
}

/**
 * How a `className` attribute can be edited, derived from its AST shape:
 * - `absent` — no `className`; insert a new attribute after the element name.
 * - `spans` — one or more fully-editable class strings (a string literal, an expression-less
 *   template, or the string arguments of `cn()`/`clsx()`). Additions go to the first span;
 *   removals apply to all. `partial` is true when sibling arguments are dynamic and untouched.
 * - `template` — a template literal *with* expressions: edit the static quasis (additions fold
 *   into the last one) and never disturb the `${…}` interpolations.
 * - `insert-arg` — a `cn()`/`clsx()` call with no string-literal argument to edit; inject one.
 * - `unsupported` — a variable, member expression (CSS Modules), conditional, unknown helper, etc.
 */
export type ClassNameAnalysis =
  | { kind: 'absent'; insertAt: number }
  | { kind: 'spans'; spans: ClassSpan[]; partial: boolean }
  | { kind: 'template'; quasis: ClassSpan[] }
  | { kind: 'insert-arg'; at: number; trailing: boolean }
  | { kind: 'unsupported'; reason: string }

/** Call helpers whose string arguments are class lists we can safely edit. */
const CLASS_HELPERS = new Set([
  'cn',
  'clsx',
  'classnames',
  'classNames',
  'cx',
  'twMerge',
  'twJoin',
  'tw',
])

// Parsed nodes always carry source offsets; the non-null assertions are a strict-mode formality.
function range(node: { start?: number | null; end?: number | null }): {
  start: number
  end: number
} {
  return { start: node.start!, end: node.end! }
}

function stringSpan(node: StringLiteral): ClassSpan {
  const { start, end } = range(node)
  return { start: start + 1, end: end - 1, text: node.value } // strip the surrounding quotes
}

function quasiSpan(node: TemplateElement): ClassSpan {
  const { start, end } = range(node)
  return { start, end, text: node.value.raw }
}

/** Classify the `className` attribute of a JSX opening element for editing. */
export function analyzeClassName(element: JSXOpeningElement): ClassNameAnalysis {
  const attr = element.attributes.find(
    (a): a is JSXAttribute =>
      a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'className',
  )
  if (!attr) return { kind: 'absent', insertAt: range(element.name).end }

  const value = attr.value
  if (!value) return { kind: 'unsupported', reason: 'className has no value' }
  if (value.type === 'StringLiteral')
    return { kind: 'spans', spans: [stringSpan(value)], partial: false }
  if (value.type === 'JSXExpressionContainer') return analyzeExpression(value.expression)
  return { kind: 'unsupported', reason: `className value is ${value.type}` }
}

function analyzeExpression(expr: JSXExpressionContainer['expression']): ClassNameAnalysis {
  switch (expr.type) {
    case 'StringLiteral':
      return { kind: 'spans', spans: [stringSpan(expr)], partial: false }
    case 'TemplateLiteral':
      return analyzeTemplate(expr)
    case 'CallExpression':
      return analyzeCall(expr)
    case 'Identifier':
      return { kind: 'unsupported', reason: 'className is a variable reference' }
    case 'MemberExpression':
      return { kind: 'unsupported', reason: 'className is a member expression (e.g. CSS Modules)' }
    case 'ConditionalExpression':
      return { kind: 'unsupported', reason: 'className is a conditional expression' }
    default:
      return { kind: 'unsupported', reason: `className expression is ${expr.type}` }
  }
}

function analyzeTemplate(tpl: TemplateLiteral): ClassNameAnalysis {
  // No interpolations: the single quasi is just a class string, safe to rejoin wholesale.
  if (tpl.expressions.length === 0) {
    return { kind: 'spans', spans: [quasiSpan(tpl.quasis[0]!)], partial: false }
  }
  return { kind: 'template', quasis: tpl.quasis.map(quasiSpan) }
}

function analyzeCall(call: CallExpression): ClassNameAnalysis {
  const callee = call.callee
  if (callee.type !== 'Identifier' || !CLASS_HELPERS.has(callee.name)) {
    const name = callee.type === 'Identifier' ? callee.name : callee.type
    return { kind: 'unsupported', reason: `className uses unsupported helper (${name})` }
  }
  const stringArgs = call.arguments.filter((a): a is StringLiteral => a.type === 'StringLiteral')
  if (stringArgs.length === 0) {
    // Nothing static to edit; inject a string argument (first, before any dynamic ones).
    const hasArgs = call.arguments.length > 0
    return {
      kind: 'insert-arg',
      at: hasArgs ? range(call.arguments[0]!).start : range(call).end - 1,
      trailing: hasArgs,
    }
  }
  return {
    kind: 'spans',
    spans: stringArgs.map(stringSpan),
    partial: stringArgs.length !== call.arguments.length,
  }
}
