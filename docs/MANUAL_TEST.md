# Manual test checklist

Unit tests + the watcher's happy-dom integration tests cover ~80% of risk. The remaining
~20% is the real Chrome DevTools flow, which can't be driven by a test runner. Run this
checklist before tagging a release.

The two demo apps cover both framework adapters:

- `examples/vite-react` — Vite + `@shiage/vite` + Tailwind v4
- `examples/next-app` — Next.js + `@shiage/next` + Tailwind v4

Run each test against **both** examples. Use real Chrome (not headless / not Chromium-derived
test browsers) — DevTools' actual UI is the thing under test.

---

## 1. Inline DevTools edit — `MutationObserver` path

The instant-feedback path. Edits made in the **Styles** pane's `element.style` block
mutate the element's `style` attribute directly, which the runtime's MutationObserver
catches with zero delay.

- [ ] Boot the demo. Right-click the button → Inspect.
- [ ] In DevTools → **Elements** → **Styles**, scroll to `element.style {}`.
- [ ] Click into it and type `padding: 0.75rem 1.5rem`.
- [ ] **Within ~50ms** of pressing Enter, the Shiage pill should say "Save 2 changes."
- [ ] Click Save. Confirm. File is rewritten, HMR repaints.

## 2. Stylesheet-rule edit — 500ms poll path

The DevTools "edit an existing rule" flow does **not** mutate the element — it changes
the CSSOM rule, which only reflects to `getComputedStyle`. The runtime catches this via
its 500ms poll.

- [ ] Boot the demo. Right-click the button → Inspect.
- [ ] In DevTools → **Elements** → **Styles**, find the rule that produces the button's
      `padding` (it'll be a Tailwind utility rule like `.px-4 {…}`).
- [ ] Edit the existing value (don't add a new declaration — edit the existing one in place).
- [ ] **Within ~500ms** the pill should update to reflect the change.
- [ ] Save → Confirm → file rewritten.

## 3. Unsupported property → explicit message

If the user edits a property Shiage doesn't map (e.g. `transform`, `filter`), the diff
panel should surface that explicitly rather than silently ignoring.

- [ ] Inspect the button. In DevTools, add `transform: rotate(5deg)`.
- [ ] Click Save.
- [ ] The diff panel should list this change under an "unsupported in v1" section with
      a clear reason — never silently dropped.

## 4. Unsupported className shape — `style={}`

Shiage's contract is editing className strings. Inline `style={…}` is a different write
target and must surface as unsupported.

- [ ] Temporarily replace the button's `className=…` in the source with `style={{ padding: '0.5rem 1rem' }}` and let HMR rebuild.
- [ ] Inspect the button. Edit `padding` in DevTools. Click Save.
- [ ] The diff panel should show "unsupported, reason: inline style attribute, not a className" (or similar) and refuse to write.
- [ ] Revert the source.

(CSS Modules `styles.foo` and `cn(variable)` produce equivalent "unsupported, reason:
variable reference" messages — re-test those if you've touched the className-merge code.)

## 5. HMR / full-reload survival

Tracking is ambient — there's no picked target to persist, so what's under test is that
the runtime re-attaches and detection still works after a reload (the watch-manager
re-discovers every stamped element; no `sessionStorage`).

- [ ] Trigger a full reload (Cmd-R in Chrome — not soft HMR).
- [ ] The Shiage pill re-mounts and the watch-manager silently re-discovers the stamped elements.
- [ ] Right-click the button → Inspect, edit `padding` in DevTools — the pill updates to
      "Save 1 change", and saving still rewrites the correct source file.

## 6. Custom theme token round-trip

Both demos define a `--color-brand` token to verify the v3/v4 ThemeSource resolves
against the user's *real* theme, not Tailwind's defaults.

- [ ] Inspect the button. In DevTools, change `background-color` to something close to but
      different from `--color-brand` (say, shift the green channel by 30 units).
- [ ] Save. The diff panel should propose either an arbitrary `bg-[#…]` class (if outside
      the nearest-color threshold) or a snapped existing theme class with a visible warning.
- [ ] Confirm — `app/page.tsx` / `src/App.tsx` is rewritten with the new class.

## 7. WS reconnect resilience

The runtime client uses exponential backoff to reconnect if the dev server restarts.

- [ ] Boot the demo. Inspect the button and make an edit so a change is staged.
- [ ] Stop the dev server (`Ctrl-C`).
- [ ] Wait ~5s. The pill should indicate disconnected state.
- [ ] Restart the dev server.
- [ ] Within ~5s of the server being back, the pill reconnects without a page reload.
      Tracked changes and save staging both survive.

## 8. Both frameworks, both Tailwind majors

The above flow must work in:

- [ ] `examples/vite-react` (Tailwind v4)
- [ ] `examples/next-app` (Tailwind v4, `next dev` or `next dev --webpack`)
- [ ] At least one v3 fixture (clone a demo, swap to `tailwindcss@3` + `tailwind.config.ts`)
      — to confirm the v3 ThemeSource path didn't regress.

---

If any item fails, file an issue with the framework, Tailwind major, exact CSS property,
and the rendered diff panel content before tagging the release.
