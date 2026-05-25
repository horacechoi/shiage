// @shiage/runtime — the browser-side runtime, built as a single IIFE that the Vite/Next plugins
// inline into the dev page. This entry just boots the overlay once the DOM is ready; all behavior
// lives in ./mount (kept separate so tests can drive it without this auto-run).
import { mount, RUNTIME_VERSION } from './mount'

export { mount, RUNTIME_VERSION }
export type { ShiageInstance, MountOptions } from './mount'

function boot(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(), { once: true })
  } else {
    mount()
  }
}

boot()
