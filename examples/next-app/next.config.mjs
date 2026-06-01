// withShiage adds a pre-enforced webpack loader rule that stamps data-shiage-loc onto JSX host
// elements + boots a standalone WS server that turns DevTools CSS edits into Tailwind class edits
// on disk. It's dev-only — `next build` / `next start` see an inert config.
//
// Phase 6 only supports webpack: Turbopack ignores the webpack() callback. On Next 16+, run
// `next dev --webpack` (Next 15 still defaults to webpack and `next dev` is enough).
import withShiage from '@shiage/next'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

export default withShiage(nextConfig)
