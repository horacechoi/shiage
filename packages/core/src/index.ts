// @shiage/core — framework-agnostic logic for Shiage.
// The CSS→Tailwind mapper, JSX AST editor, WebSocket protocol, and diff generator
// are implemented across Phases 1, 2, and 5.

export * from './supported'
export type * from './tailwind/types'

// Tailwind theme sources (Node-only; the browser runtime imports only ./supported + protocol types).
export { detectThemeSource, type DetectOptions } from './tailwind/detect'
export { createV4ThemeSource, type CreateV4Options } from './tailwind/v4'
export { createV3ThemeSource, type CreateV3Options } from './tailwind/v3'
export {
  buildReverseLookup,
  normalizeValueForKind,
  type ReverseLookup,
  type ColorTable,
  type ColorEntry,
} from './tailwind/reverse-lookup'

// The CSS → Tailwind mapper.
export {
  findClassForProperty,
  classProducingProperty,
  mapChangesToClassEdits,
  type ClassMatch,
  type ClassEdits,
  type PropertyChange,
  type FindOptions,
} from './mapper'

// The JSX/TSX AST editor (Node-only): locate an element by stamped source location and rewrite
// its className in place, preserving formatting.
export { parseJsx } from './ast/parse'
export { findOpeningElementByLoc, type SourceLoc } from './ast/find'
export { analyzeClassName, type ClassNameAnalysis, type ClassSpan } from './ast/classname'
export { mergeClassString } from './ast/merge'
export { editJsxSource, editJsxFile, type EditResult, type ClassNameEdits } from './ast/edit'
