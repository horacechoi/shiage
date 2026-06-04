# Releasing

Releases are automated with [Changesets](https://github.com/changesets/changesets) + the
`.github/workflows/release.yml` GitHub Action. **You never run `npm publish` by hand.**

## The flow

1. **Land a change with a changeset.** In your feature branch, run:

   ```sh
   pnpm changeset
   ```

   Pick the affected packages and bump type (patch/minor/major) and write a one-line summary. This
   creates a file under `.changeset/`. Commit it alongside your code, open a PR, and merge to `main`.

   > Bump the packages you changed; the `@shiage/runtime` IIFE is inlined by `@shiage/vite` and
   > `@shiage/next` via a `workspace:*` dependency, so a runtime/core bump automatically cascades a
   > patch bump (with updated dependency versions) to those packages — they re-publish so users get
   > the new runtime.

2. **Merge the auto-opened "Version Packages" PR.** On push to `main`, the Release action opens (or
   updates) a PR that applies every pending changeset: bumps versions, writes `CHANGELOG.md`s, and
   deletes the consumed changesets. Review and merge it.

3. **Publish happens automatically.** Merging the Version PR triggers the action again; with no
   pending changesets it runs `pnpm release` (`pnpm build && changeset publish`) and publishes the
   bumped packages to npm.

## One-time setup

These are repository settings on GitHub — do them once.

### 1. npm automation token

`changeset publish` needs a token that can publish to the `@shiage` scope **without a 2FA prompt**:

- npm → **Access Tokens** → **Generate New Token** → **Classic Token** → type **Automation**
  (Automation tokens bypass 2FA, which is required for CI). A **Granular** token also works if it
  has **Read and write** to the `@shiage` packages/scope **and** "Bypass 2FA" enabled — but
  Automation is simplest.
- Confirm the token's account has **publish** rights to every `@shiage/*` package (being an org
  member is not enough; you need write/publish on the packages).

Add it to the repo: **Settings → Secrets and variables → Actions → New repository secret**, name
**`NPM_TOKEN`**.

### 2. Let Actions open the Version PR

**Settings → Actions → General → Workflow permissions:**

- Select **Read and write permissions**.
- Check **Allow GitHub Actions to create and approve pull requests**.

Without this, the action can't open the "Version Packages" PR.

## First release of this fix

A changeset for the "record only DevTools edits" fix is already in `.changeset/`. Once `main` has
the release workflow + this changeset (merge `foundation` → `main`), the Version PR appears
automatically; merging it publishes the patch.
