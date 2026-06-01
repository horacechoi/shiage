// A small webpack loader that runs @shiage/jsx-transform's Babel plugin on .tsx/.jsx during
// `next dev --webpack`. The loader rule is registered with `enforce: 'pre'` so this runs before
// Next's SWC compiles JSX away (once `<JSXOpeningElement>` is gone, there's no node to stamp).
//
// Shipped as CommonJS (tsup `format: ['cjs']`) so webpack can require() it directly. The Babel
// stamp plugin from @shiage/jsx-transform — an ESM-only package — is bundled in via tsup's
// `noExternal`, sidestepping ESM-from-CJS interop at loader-load time.
//
// We mirror the Vite plugin's transform shape exactly: same parser plugins, same babelrc:false /
// configFile:false isolation, same projectRoot-relative stamping.
import { transformSync } from '@babel/core'
import type { LoaderContext } from 'webpack'
import shiageStampPlugin from '@shiage/jsx-transform'

export interface ShiageLoaderOptions {
  /** Absolute project root the stamp resolves paths against; usually `process.cwd()`. */
  projectRoot: string
}

// Webpack's preferred async API: callback(err, code, map). We could go sync — Babel is sync — but
// declaring async keeps the loader composable with future async work without an API break.
export default function shiageLoader(
  this: LoaderContext<ShiageLoaderOptions>,
  source: string,
): void {
  const callback = this.async()
  const options = this.getOptions()
  const filename = this.resourcePath
  try {
    const result = transformSync(source, {
      filename,
      root: options.projectRoot,
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      parserOpts: { plugins: ['jsx', 'typescript'] },
      plugins: [[shiageStampPlugin, { projectRoot: options.projectRoot }]],
    })
    if (!result?.code) {
      callback(null, source)
      return
    }
    callback(null, result.code, (result.map ?? undefined) as Parameters<typeof callback>[2])
  } catch (err) {
    callback(err as Error)
  }
}
