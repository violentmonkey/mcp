# Extension WebSocket protocol

Endpoint: `ws://<host>:<port>/ws`. All frames are JSON text. Version: `1`.

Types are defined in `@violentmonkey/mcp-protocol`.

## Handshake

The client must send `hello` as its first frame within 5 s of the socket opening. The token is sent in the frame, not the URL, so it does not end up in access logs.

```jsonc
// client -> server
{
  "type": "hello",
  "protocol": 1,
  "token": "<token>",
  "client": { "name": "Violentmonkey", "version": "2.31.0" },
  "tools": ["scripts_list", "scripts_get", "scripts_write"]
}
```

```jsonc
// server -> client, on success
{
  "type": "ready",
  "protocol": 1,
  "server": { "name": "@violentmonkey/mcp", "version": "0.1.0" },
  "tools": ["scripts_list", "scripts_get", "scripts_write"] // accepted subset
}
```

On failure the server closes the socket without further detail:

| Close code | Meaning | Client should reconnect? |
| --- | --- | --- |
| 4000 | Malformed or missing `hello` / timeout | no |
| 4001 | Replaced by a newer connection | no |
| 4002 | Closed intentionally (user disconnected, server shutting down) | no |
| 4003 | Invalid token or disallowed `Origin` | no |
| 4004 | Unsupported protocol version | no |
| other | Network failure | yes, with backoff |

The server checks the `Origin` header on upgrade and only accepts `chrome-extension://`, `moz-extension://` and `extension://` schemes (and missing `Origin` only when `VM_MCP_ALLOW_NO_ORIGIN=1`, for tests). Token comparison is constant time.

## Tool calls

```jsonc
// server -> client
{ "type": "call", "id": "c_17", "tool": "scripts_get", "params": { "id": 3 } }

// client -> server, success
{ "type": "result", "id": "c_17", "ok": true, "data": { /* tool output */ } }

// client -> server, failure
{ "type": "result", "id": "c_17", "ok": false, "error": { "code": 404, "message": "Script 3 not found" } }
```

- `id` is a server-generated string, unique per connection.
- Multiple calls may be in flight; results may arrive in any order.
- The server times out a call after 30 s and returns `504`. A late `result` for an unknown id is ignored.
- A `result` with `ok: true` is validated against the tool's output schema; invalid data becomes `502` for the agent.

## Heartbeat

```jsonc
{ "type": "ping" }   // client -> server, every 20 s
{ "type": "pong" }   // server -> client, immediate
```

## Error codes

| Code | Meaning |
| --- | --- |
| 400 | Invalid params, or code whose metadata block cannot be parsed |
| 403 | Denied by the user or by extension settings |
| 404 | Target not found |
| 500 | Handler threw |
| 502 | Extension returned data that violates the output schema |
| 503 | Extension not connected (server-generated) |
| 504 | Extension did not respond in time (server-generated) |

## Versioning

`protocol` is an integer bumped only for breaking wire changes. Adding tools is not breaking: the `tools` negotiation in `hello`/`ready` handles it.
