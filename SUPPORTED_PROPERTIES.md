# Supported CSS properties (v1)

> **Generated from `packages/core/src/supported.ts` — do not edit by hand.** Run `pnpm gen:supported`.

Shiage maps changes to these CSS properties back to Tailwind classes. The browser runtime only
flags changes to these properties; anything else shows a "not supported in v1, edit your code
directly" message.

Shiage assumes the default **16px root font size** when matching Tailwind's rem-based scales. If
you've changed `html { font-size }`, exact matches may fall back to arbitrary px values.

| Category | CSS property | Match type |
| --- | --- | --- |
| Spacing | `column-gap` | length |
| Spacing | `gap` | length |
| Spacing | `margin` | length |
| Spacing | `margin-bottom` | length |
| Spacing | `margin-left` | length |
| Spacing | `margin-right` | length |
| Spacing | `margin-top` | length |
| Spacing | `padding` | length |
| Spacing | `padding-bottom` | length |
| Spacing | `padding-left` | length |
| Spacing | `padding-right` | length |
| Spacing | `padding-top` | length |
| Spacing | `row-gap` | length |
| Sizing | `height` | length |
| Sizing | `max-height` | length |
| Sizing | `max-width` | length |
| Sizing | `min-height` | length |
| Sizing | `min-width` | length |
| Sizing | `width` | length |
| Typography | `color` | color |
| Typography | `font-size` | length |
| Typography | `font-weight` | number |
| Typography | `letter-spacing` | length |
| Typography | `line-height` | length |
| Typography | `text-align` | keyword |
| Background | `background-color` | color |
| Border | `border-bottom-left-radius` | length |
| Border | `border-bottom-right-radius` | length |
| Border | `border-bottom-width` | length |
| Border | `border-color` | color |
| Border | `border-left-width` | length |
| Border | `border-radius` | length |
| Border | `border-right-width` | length |
| Border | `border-style` | keyword |
| Border | `border-top-left-radius` | length |
| Border | `border-top-right-radius` | length |
| Border | `border-top-width` | length |
| Border | `border-width` | length |
| Effects | `box-shadow` | shadow |
| Effects | `opacity` | number |

Total: 40 properties.
