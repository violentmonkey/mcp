# Security

Allowing an agent to write userscripts is equivalent to letting it run JavaScript on any site you visit. The design therefore assumes the agent is useful but not fully trusted, and that other local software and web pages are hostile.

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| A web page links to `mcp_connect.html?port=…&token=…` pointing at an attacker's server, to make the extension talk to it | The extension never connects automatically. It shows an authorization page with the host and port, and requires a user click. Only loopback hosts are allowed by default. |
| A web page connects to the local server from JavaScript | The server checks the `Origin` header on the WebSocket upgrade and only accepts browser extension schemes. A valid token is also required. |
| Another local process connects | It needs the token, which is random (256 bits), delivered only to the agent via `vm_status`/stderr, and compared in constant time. |
| DNS rebinding against the HTTP endpoints | The server validates the `Host` header (`127.0.0.1`, `localhost`, `[::1]`, or the configured `--host`) and rejects others. |
| Token leakage in logs | The token travels in the `hello` frame, not the URL of the WebSocket. The connect URL (which includes the token) is only printed to stderr and returned by `vm_status`. |
| Extension injecting prompt-injection payloads as tool descriptions | Tools and descriptions are defined by the server package. |
| Script content returned to the agent contains prompt injection | Cannot be fully prevented. Tool results are plain data; agents should treat them as untrusted. |
| Agent overwrites or deletes scripts unexpectedly | Destructive tools carry MCP annotations so clients can prompt. The extension should offer a read-only mode and optional confirmation for writes (error `403` when denied). |
| Remote access via the HTTP transport | `/mcp` requires `Authorization: Bearer <token>`. Default bind is loopback. Binding to non-loopback hosts prints a warning; TLS must be provided by the user (e.g. a reverse proxy). |

## Defaults

- Bind address: `127.0.0.1`.
- Token: random per start, unless `--token` / `VM_MCP_TOKEN` is set.
- HTTP transport: off.
- Read-only mode (`--readonly`): off. When on, write tools are not exposed to the agent, and the server refuses to accept them from the extension.
- Single extension connection; a new connection must present the valid token to replace the existing one.

## Recommendations for the extension

- Display the server address and the list of requested tools on the authorization page.
- Remember authorization only for the current server token; do not persist a token across browser restarts without the user's consent.
- Provide a visible "connected" indicator and a one-click disconnect (close code `4002`).
- Offer its own read-only setting that rejects `scripts_write`, `scripts_set_enabled` and `scripts_delete` with `403`, in addition to the server's `--readonly` flag.
