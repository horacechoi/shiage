# Contributing to Shiage

Thanks for reading this — bug reports, PRs, and discussion are all welcome. Shiage is
young (v0.1) and the API will change before `1.0`, so the safest contribution flow is:

1. **For anything non-trivial, open an issue first.** Quick "fixing a typo" or "this
   crash log is reproducible" PRs don't need pre-discussion. Anything that adds a new
   supported property, changes the protocol, touches the AST editor's className-merge
   behavior, or adds a framework adapter — let's talk first so we don't waste your time.
2. Fork → branch → PR against `main`.

## Local setup

Requirements: **Node 22.x**, **pnpm 9** (via corepack works fine).

```bash
git clone https://github.com/horacechoi/shiage
cd shiage
pnpm install
pnpm -r build
pnpm test
```

The build is topologically ordered — `@shiage/runtime` builds before `@shiage/vite` so
the Vite plugin can inline its IIFE.

## The contract

Before opening a PR, all of these must be green:

```bash
pnpm test         # vitest run — Node env by default; runtime tests use happy-dom
pnpm typecheck    # tsc --noEmit across all packages
pnpm lint         # eslint
pnpm format       # prettier --write . — no semicolons, single quotes, 100 cols
pnpm gen:supported && git diff --exit-code SUPPORTED_PROPERTIES.md
```

CI runs all five on every push and PR — if any fail there, they were broken locally too.

## House style

- **TypeScript strict mode**, `verbatimModuleSyntax` — use `import type` for type-only
  imports.
- **Prettier**: no semicolons, single quotes, 100-column wrap, trailing commas.
- **No comments for what the code already says** — comments are for *why*, edge cases,
  invariants the code itself can't show.
- **Test every unit of logic.** Mapper, AST editor, transform, watcher — every change
  should add or update tests. The test suite is the contract.
- **Tailwind v3 and v4 must both pass.** Mapper tests run against both fixtures; if you
  add a property, add it to both.

## Adding a CSS property

Single source of truth lives in
[`packages/core/src/supported.ts`](packages/core/src/supported.ts) — add to the typed
`SUPPORTED_PROPERTIES` const, then run `pnpm gen:supported` to regenerate
[`SUPPORTED_PROPERTIES.md`](SUPPORTED_PROPERTIES.md). CI fails if the markdown drifts
from the source.

If the property's mapping needs special handling beyond the standard
namespace+kind+group, also update the mapper in `packages/core/src/mapper/`.

## Changesets

User-facing changes need a changeset:

```bash
pnpm changeset      # interactive — picks which packages and what semver bump
```

Commit the resulting `.changeset/*.md` file alongside your code. Releases ride the
Changesets workflow.

## Commit + PR conventions

- Imperative subject lines, present tense ("add", "fix", "remove"), keep them short.
- One logical change per PR. If your PR description starts with "and also…", split it.
- Tag PR description with `Fixes #N` if it closes an issue.

## Code of conduct

Be kind. Discuss the code, not the person. Maintainers can decline any PR; we'll try to
explain why when we do.
