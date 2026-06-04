# @shiage/runtime

## 0.1.1

### Patch Changes

- 5900159: Record only DevTools edits — stop capturing animations as user changes.

  Scroll/CSS animations, `@keyframes` (incl. infinite and scroll-driven), the Web Animations API
  (Framer Motion / Motion One), and JS-driven inline-style writes (GSAP/`requestAnimationFrame`,
  React re-renders, one-shot scripts, and custom-property `var()` writes) no longer surface as
  phantom CSS changes in the Shiage panel.

  Detection now distinguishes page-origin mutations from genuine DevTools edits: the runtime
  instruments the page's own style/class mutation APIs (and watches CSS transition/animation events +
  `getAnimations()`), absorbing anything page-driven into the baseline. A DevTools edit — which
  uniquely bypasses page JavaScript — is the only thing recorded.

- Updated dependencies [5900159]
  - @shiage/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release. Shiage (仕上げ, "finishing touches") lets you edit CSS live in
  Chrome DevTools and save those tweaks back to source as Tailwind class edits. v0.1 ships
  the Vite plugin, the Next.js (webpack) plugin, and the supporting core, runtime, and
  Babel-transform packages, with a 40-property mapper that drives Tailwind's own engine
  against your real resolved theme on both v3 and v4.

### Patch Changes

- Updated dependencies
  - @shiage/core@0.1.0
