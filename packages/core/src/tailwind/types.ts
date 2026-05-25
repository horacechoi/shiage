import type { TailwindNamespace } from '../supported'

export type TailwindVersion = 3 | 4

/** A normalized CSS declaration: a longhand property and its value (lowercased, trimmed). */
export interface CssDecl {
  readonly property: string
  readonly value: string
}

/**
 * A version-agnostic adapter over a project's Tailwind theme.
 *
 * The v3 and v4 adapters obtain the theme very differently (v3 resolves `tailwind.config.*`;
 * v4 drives Tailwind's own `DesignSystem` engine), but both expose the same primitives here.
 * Everything downstream — the reverse-lookup builder and the mapper — consumes only this
 * interface and never touches version specifics.
 */
export interface ThemeSource {
  readonly version: TailwindVersion

  /** Absolute path that triggered detection (the v3 config file or the v4 CSS entry). */
  readonly sourcePath: string

  /**
   * Forward map: for each input class, the longhand CSS declarations it generates.
   * The result is parallel to the input. An unknown or invalid class yields an empty array.
   */
  classToDecls(classNames: string[]): CssDecl[][]

  /** Every concrete utility name the theme can produce in the given namespaces. */
  enumerateCandidates(namespaces: readonly TailwindNamespace[]): string[]

  /**
   * Collapse arbitrary-value classes to their canonical form with px↔rem normalization
   * (e.g. `p-[16px]` → `p-4`). v3 has no canonicalizer and returns the input unchanged.
   *
   * @param rootFontSizePx the page's root font size, used to convert px↔rem (default 16).
   */
  canonicalize(classNames: string[], rootFontSizePx: number): string[]

  /** Resolve a theme token to a concrete value, e.g. `resolveToken('--spacing')` → `'0.25rem'`. */
  resolveToken(path: string): string | undefined
}
