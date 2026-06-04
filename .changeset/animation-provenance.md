---
'@shiage/core': patch
'@shiage/runtime': patch
---

Record only DevTools edits — stop capturing animations as user changes.

Scroll/CSS animations, `@keyframes` (incl. infinite and scroll-driven), the Web Animations API
(Framer Motion / Motion One), and JS-driven inline-style writes (GSAP/`requestAnimationFrame`,
React re-renders, one-shot scripts, and custom-property `var()` writes) no longer surface as
phantom CSS changes in the Shiage panel.

Detection now distinguishes page-origin mutations from genuine DevTools edits: the runtime
instruments the page's own style/class mutation APIs (and watches CSS transition/animation events +
`getAnimations()`), absorbing anything page-driven into the baseline. A DevTools edit — which
uniquely bypasses page JavaScript — is the only thing recorded.
