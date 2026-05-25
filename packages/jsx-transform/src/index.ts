// @shiage/jsx-transform — a Babel plugin that stamps `data-shiage-loc` source locations onto JSX
// host elements, so the browser runtime can resolve a picked DOM node back to its JSX origin.
//
// The default export is the plugin, so it can be used as `plugins: [shiageStampPlugin]` (or by
// module name) in any Babel pipeline. It must run before the JSX transform.
export { default, default as shiageStampPlugin, STAMP_ATTRIBUTE } from './babel-plugin'
export type { ShiageStampOptions } from './babel-plugin'
