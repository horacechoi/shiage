/**
 * Merge class edits into one space-separated class string.
 *
 * Drops every token in `remove`, then appends every token in `add` that isn't already present,
 * preserving the order of surviving tokens. Unrelated and variant-prefixed tokens (`md:p-4`,
 * `hover:bg-x`) are left in place unless explicitly removed; the result is single-spaced and not
 * reordered. Deciding *which* existing tokens conflict and belong in `remove` is the mapper's
 * job (`mapChangesToClassEdits`); this function is pure text and asks no questions.
 */
export function mergeClassString(
  existing: string,
  add: readonly string[],
  remove: readonly string[],
): string {
  const removeSet = new Set(remove)
  const kept = existing.split(/\s+/).filter((tok) => tok.length > 0 && !removeSet.has(tok))

  const present = new Set(kept)
  const result = [...kept]
  for (const tok of add) {
    if (!present.has(tok)) {
      result.push(tok)
      present.add(tok)
    }
  }
  return result.join(' ')
}
