# Design

## Goals

- Let an agent create, read, edit, and delete Violentmonkey scripts.
- Lightweight: one `npx` command, no persistent state, no config files.
- The server defines what is allowed; the extension cannot add arbitrary tools.
- The user explicitly authorizes every connection.

## Components

### `@violentmonkey/mcp-protocol`

Pure TypeScript, no I/O. Two entry points:

- `@violentmonkey/mcp-protocol`: constants (protocol version, error and close codes, `ToolCallError`) and inferred types. No runtime dependencies; this is all the client imports.
- `@violentmonkey/mcp-protocol/schemas`: the zod schemas, imported by the server only. Contains:

- `tools`: a map of tool name to `{ description, input, output, annotations }`. Used by the server to register MCP tools; the client only uses its inferred types.
- Wire message types and the error code table (see [protocol.md](protocol.md)).

### `@violentmonkey/mcp` (server)

Processes:

1. **MCP front end** using `@modelcontextprotocol/sdk` `McpServer`, with either `StdioServerTransport` or `StreamableHTTPServerTransport`.
2. **Bridge** (Hono app on `@hono/node-server` + `@hono/node-ws`) listening on `host:port`:
   - `GET /ws` - WebSocket upgrade for the extension.
   - `POST|GET|DELETE /mcp` - Streamable HTTP MCP, only when `--transport http`.
   - `GET /health` - unauthenticated liveness probe returning `{ "ok": true }` only (no connection or token info).
3. **Session** - holds the single extension connection, pending request table, and capabilities.

Both front ends share the same `McpServer` tool registration, so tool behavior is identical across transports. In HTTP mode, each MCP session gets its own `McpServer` instance, but all of them share the one Session.

### `@violentmonkey/mcp-client`

A small WebSocket client (browser `WebSocket`, no Node dependencies) that performs the handshake, dispatches calls to registered handlers, sends heartbeats and reconnects.

## Lifecycle

1. The server starts, generates a random token (32 bytes, base64url) unless one is supplied, and binds to `127.0.0.1:<port>`.
2. The agent calls `vm_status`, which reports `connected: false` plus `connectUrl`.
3. The user opens `https://violentmonkey.github.io/mcp_connect.html?port=…&token=…`.
   - The extension intercepts this navigation and redirects to its own authorization page, showing the port and requested tool set.
   - That page is a static, harmless stub if the extension is not installed.
4. On approval the extension opens `ws://127.0.0.1:<port>/ws` and sends `hello` with the token.
5. The server verifies the token and `Origin`, replies `ready` with the list of exposed tools, and from then on forwards tool calls.
6. On disconnect, pending calls are rejected and tools report 503 until the extension returns.

## Single connection

At most one extension connection is active.

- A new connection with a **valid token** while one is already open **replaces** the old one (the old socket is closed with code 4001, "replaced"). This is necessary because MV3 service workers die and reconnect, and the server may not have noticed the old socket is dead yet.
- A connection with an invalid token is rejected (close code 4003) and does not affect the active one.

## Capabilities

The server's tool registry is the allow list. In `hello`, the client sends the names of the tools it has handlers for. The server exposes the intersection of that set and its own registry, and emits MCP `tools/list_changed` when it changes (connect, disconnect, replace).

- Unknown tool names from the client are ignored.
- Old extension versions without e.g. `scripts_delete` simply do not get that tool.
- `vm_status` is always exposed and handled by the server itself.
- While disconnected, all tools stay listed (so agents are not confused by a vanishing tool list) but calls fail with 503. This is a deliberate choice: `list_changed` is applied only when the connected set of tools changes while connected.

## Tool calls

```
agent ──tools/call──► server ──call{id,tool,params}──► extension
                         ◄──result{id,ok,data|error}──
```

1. The server validates `params` against the tool's input schema (MCP SDK does this) before forwarding.
2. It sends a `call` message with a unique id and starts a 30 s timeout.
3. The extension runs the handler and responds with `result`. It does not re-validate params; the client library is deliberately validation-free to stay small.
4. The server validates the response against the output schema; a mismatch becomes error `502`.
5. Errors are returned as MCP tool results with `isError: true` and text `[code] message`. Protocol-level MCP errors are used only for genuinely malformed MCP requests.

Error codes: `503` not connected / disconnected during call, `504` timeout, `502` invalid response from extension, `404` script not found, `400` invalid params, `403` denied by user (read-only mode or declined confirmation), `500` handler failure.

## Liveness

- The client sends `ping` every 20 s; the server answers `pong`. Either side closes the socket after 60 s of silence.
- The 20 s interval also keeps an MV3 service worker alive while connected.
- Client reconnect: exponential backoff from 1 s to 30 s. It stops on close codes 4003 (bad token) and 4002 (user disconnected).

## Why not let the extension register arbitrary tools?

Tool descriptions are injected into the agent's context. If the extension (or anything able to impersonate it) could supply descriptions, that is a prompt-injection channel. With server-defined tools, descriptions are vetted and shipped with the package.

## Non-goals (for now)

- Multiple simultaneous extensions/browsers.
- Persisting tokens or auto-reconnect across server restarts (a restarted stdio server gets a new token by design; use a fixed token with the HTTP transport if you need this).
- Running scripts in tabs and reading console logs (planned as later tools: `script_logs`, `tab_eval`).
