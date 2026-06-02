// The `<ShiageDevScripts />` component — a tiny sliver of JSX the user adds to their root layout
// (App Router) or _document (Pages Router). At dev time + when the WS server has booted it emits
// the meta tag the runtime reads to find its port and inlines the runtime IIFE. In production it
// renders nothing. If we're in dev but the boot never happened — almost always because Turbopack
// is active and ignored our `webpack()` callback — it warns once and renders nothing.
//
// The component is synchronous in both routers (App and Pages): we awaited the boot inside the
// webpack callback, so by the time SSR runs the singleton state is sync-available.
import * as React from 'react'
import { getDevState } from './dev-server'

let warnedAboutMissingState = false

function warnTurbopack(): void {
  if (warnedAboutMissingState) return
  warnedAboutMissingState = true

  console.warn(
    '[shiage] dev server not booted — Turbopack ignores webpack() config. ' +
      'Run `next dev --webpack` (Next 16+) or `next dev` with Turbopack disabled.',
  )
}

/**
 * Drop into the root layout (App Router) or _document body (Pages Router) — typically as the last
 * child of `<body>`, so the runtime auto-mounts after the app paints. Production renders null.
 */
export function ShiageDevScripts(): React.ReactElement | null {
  if (process.env.NODE_ENV !== 'development') return null
  const state = getDevState()
  if (!state) {
    warnTurbopack()
    return null
  }
  // The IIFE is bundler-emitted JavaScript; it could in principle contain a `</script>` string
  // that would prematurely close our inline script tag. Replace defensively, preserving case with
  // a capture group (browsers parse tag names case-insensitively, so `</SCRIPT>` also closes). The
  // capture group keeps `<\/SCRIPT>` rather than collapsing to lowercase. React's
  // dangerouslySetInnerHTML does no HTML escaping itself.
  const iife = state.runtimeIife.replace(/<(\/script)/gi, '<\\$1')
  return (
    <>
      <meta name="shiage-ws-port" content={String(state.port)} />
      <script dangerouslySetInnerHTML={{ __html: iife }} />
    </>
  )
}
