// Coverage for the ShiageDevScripts React component. The component returns React elements
// directly — we assert on their structure rather than rendering through react-dom/server, which
// keeps the suite Node-environment only (matching the rest of @shiage/next).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'

vi.mock('../src/dev-server', () => ({
  getDevState: vi.fn(),
}))

import { ShiageDevScripts } from '../src/dev-scripts'
import { getDevState } from '../src/dev-server'

const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

beforeEach(() => {
  consoleWarn.mockClear()
  vi.mocked(getDevState).mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// vi.stubEnv is the vitest-blessed way: process.env.NODE_ENV is locked to a non-configurable
// data descriptor in Node 22, so defineProperty throws. Stub-and-unstub keeps tests isolated.
function setEnv(env: string): void {
  vi.stubEnv('NODE_ENV', env)
}

describe('<ShiageDevScripts />', () => {
  it('renders null in production regardless of state', () => {
    setEnv('production')
    vi.mocked(getDevState).mockReturnValue({ port: 1234, runtimeIife: '// hi' })
    expect(ShiageDevScripts()).toBeNull()
  })

  it('in dev with no state: renders null and warns once about Turbopack', () => {
    setEnv('development')
    vi.mocked(getDevState).mockReturnValue(null)
    expect(ShiageDevScripts()).toBeNull()
    expect(ShiageDevScripts()).toBeNull() // second call shouldn't re-warn
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn.mock.calls[0]?.[0]).toMatch(/Turbopack|--webpack/)
  })

  it('in dev with state: emits a Fragment of [meta, script] with port and inlined IIFE', () => {
    setEnv('development')
    vi.mocked(getDevState).mockReturnValue({ port: 5555, runtimeIife: 'console.log("hi")' })
    const element = ShiageDevScripts() as React.ReactElement<{ children: React.ReactNode }>
    expect(element).not.toBeNull()
    expect(element.type).toBe(React.Fragment)
    const children = React.Children.toArray(element.props.children) as Array<
      React.ReactElement<Record<string, unknown>>
    >
    expect(children).toHaveLength(2)
    expect(children[0]!.type).toBe('meta')
    expect(children[0]!.props).toMatchObject({ name: 'shiage-ws-port', content: '5555' })
    expect(children[1]!.type).toBe('script')
    expect(children[1]!.props.dangerouslySetInnerHTML).toEqual({
      __html: 'console.log("hi")',
    })
  })

  it('escapes any inline `</script>` in the IIFE so the inline script tag cannot be closed early', () => {
    setEnv('development')
    vi.mocked(getDevState).mockReturnValue({
      port: 1,
      runtimeIife: 'var s = "</script>"; var t = "</SCRIPT>";',
    })
    const element = ShiageDevScripts() as React.ReactElement<{ children: React.ReactNode }>
    const script = (
      React.Children.toArray(element.props.children) as Array<
        React.ReactElement<{ dangerouslySetInnerHTML: { __html: string } }>
      >
    )[1]!
    expect(script.props.dangerouslySetInnerHTML.__html).toBe(
      'var s = "<\\/script>"; var t = "<\\/SCRIPT>";',
    )
  })
})
