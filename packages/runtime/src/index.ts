// @shiage/runtime — the browser-side runtime, built as a single IIFE that the Vite/Next plugins
// inline into the dev page. This entry just boots the overlay once the DOM is ready; all behavior
// lives in ./mount (kept separate so tests can drive it without this auto-run).
import { mount, RUNTIME_VERSION } from './mount'
import { installProvenance } from './provenance'

export { mount, RUNTIME_VERSION }
export type { ShiageInstance, MountOptions } from './mount'

// Install the origin instrumentation as the very first thing the IIFE does — BEFORE `boot()` and
// before any application module evaluates — so app/library/React style writes are tagged from the
// start (and can't cache an un-patched method reference). Patching only runs in dev (the plugins
// inject this runtime in dev only); `mount()`'s teardown restores it. See provenance.ts.
installProvenance()

function boot(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(), { once: true })
  } else {
    mount()
  }
}

boot()
