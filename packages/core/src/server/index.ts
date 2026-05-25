// @shiage/core/server — Node-only WebSocket + save-flow plumbing shared by the dev-server plugins.
// Kept out of the main barrel (and behind its own subpath export) so it never reaches the browser
// runtime, which imports only @shiage/core/supported and @shiage/core/protocol.
export { startWsServer } from './ws-server'
export type { WsConnection, WsServerHandle, StartWsServerOptions } from './ws-server'

export { wireProtocol } from './protocol'
export type { ProtocolContext, ProtocolHandler } from './protocol'
