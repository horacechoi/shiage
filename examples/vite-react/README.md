# Shiage · Vite + React demo

A minimal Vite + React + Tailwind v4 app wired with `@shiage/vite`, for exercising the
full edit → detect → save → confirm flow end-to-end.

```bash
pnpm install          # from the repo root
pnpm -r build         # build @shiage/runtime (the plugin inlines its IIFE)
pnpm --filter @shiage-example/vite-react dev
```

### Try it

1. Open the printed URL in Chrome.
2. Right-click the button (*"Tweak my padding in DevTools"*) → **Inspect**, then edit its
   `padding` from `0.5rem 1rem` to `0.75rem 1.5rem` in the Styles pane.
3. Shiage picks the change up automatically — no element to "pick" first. The **Shiage
   pill** (bottom-right) reads **"Save 2 changes."** Click it.
4. The diff panel previews a className edit: `px-4 py-2` → `px-6 py-3`. Click **Confirm**.
5. Check [`src/App.tsx`](src/App.tsx) — the button's `className` is updated; HMR has
   already repainted the browser.

### Bonus: prove the real-theme round-trip

The custom `--color-brand` token in [`src/index.css`](src/index.css) exists to prove
Shiage maps against this project's *real* theme. Try editing the button's
`background-color` to a different color in DevTools — Shiage either snaps to an existing
theme color (`bg-red-500`) or falls back to an arbitrary value (`bg-[#abcdef]`),
all driven by Tailwind's own engine.
