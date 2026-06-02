<!-- Thanks for sending a PR. For non-trivial changes please open an issue first — see CONTRIBUTING.md. -->

## What this PR does

<!-- One or two sentences. -->

## Why

<!-- Link the issue if there is one: Fixes #N -->

## Checklist

- [ ] `pnpm test` is green locally.
- [ ] `pnpm typecheck && pnpm lint` are green locally.
- [ ] `pnpm gen:supported && git diff --exit-code SUPPORTED_PROPERTIES.md` is clean (if I touched `packages/core/src/supported.ts`).
- [ ] I added or updated tests covering the change.
- [ ] I added a changeset (`pnpm changeset`) if this is a user-facing change.
- [ ] I updated docs/README if user-visible behavior changed.

## Notes for reviewers

<!-- Tricky parts, design choices worth flagging, things you're unsure about. -->
