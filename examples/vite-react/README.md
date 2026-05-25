# Shiage · Vite + React demo

A minimal Vite + React + Tailwind v4 app wired with `@shiage/vite`, for exercising the full
pick → edit → save → confirm flow end-to-end.

```bash
pnpm install          # from the repo root
pnpm -r build         # build @shiage/runtime (the plugin inlines its IIFE)
pnpm --filter @shiage-example/vite-react dev
```

Then open the printed URL, click the Shiage pill (bottom-right), pick the button, edit its
`padding` in Chrome DevTools, and hit **Save** — the diff panel shows the proposed Tailwind class
edit, and confirming rewrites `src/App.tsx` on disk (HMR repaints).

The custom `--color-brand` token in `src/index.css` is there to prove Shiage maps against this
project's real theme (`bg-brand`), not just Tailwind's defaults.
