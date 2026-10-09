# Violentmonkey MCP

Let AI agents (Claude, etc.) manage your [Violentmonkey](https://violentmonkey.github.io/) userscripts through the [Model Context Protocol](https://modelcontextprotocol.io/).

Violentmonkey runs inside the browser and cannot listen on a port, so a small local server bridges the two sides:

```
┌────────┐  MCP (stdio or HTTP)  ┌──────────────────┐   WebSocket   ┌───────────────┐
│ Agent  │ ────────────────────► │ @violentmonkey/  │ ◄──────────── │ Violentmonkey │
│(Claude)│ ◄──────────────────── │ mcp  (server)    │ ──────────►   │  (extension)  │
└────────┘                       └──────────────────┘  tool calls   └───────────────┘
```

- The **agent** speaks MCP to the server.
- The **extension** connects to the server over a WebSocket, authenticated with a one-time token.
- The server owns the list of tools and their schemas. Agent tool calls are forwarded to the extension and the results are returned.

## Usage

### 1. Add the server to your agent

Claude Code:

```sh
claude mcp add violentmonkey -- npx -y @violentmonkey/mcp -p 5678
```

Claude Desktop / any stdio-based client (`mcpServers` config):

```json
{
  "mcpServers": {
    "violentmonkey": {
      "command": "npx",
      "args": ["-y", "@violentmonkey/mcp", "-p", "5678"]
    }
  }
}
```

### 2. Connect Violentmonkey

Ask the agent to call `vm_status`. It returns a connect URL such as:

```
https://violentmonkey.github.io/mcp_connect.html?port=5678&token=<generated_token>
```

Open it in the browser. Violentmonkey intercepts the URL and shows an authorization page; after you approve, the extension connects to the server and the tools become usable.

The same URL is also printed to stderr when the server starts.

### 3. Use it

> "List my userscripts", "Create a script that hides the sidebar on example.com", "Fix the bug in my GitHub script".

## CLI

```
npx @violentmonkey/mcp [options]

  -p, --port <number>        Port for the extension (and HTTP transport). Default: 5678
      --host <host>          Bind address. Default: 127.0.0.1
      --token <string>       Use a fixed token instead of generating one. Env: VM_MCP_TOKEN
      --readonly             Only expose read-only tools (no create, update, enable or delete)
      --transport <type>     MCP transport: "stdio" (default) or "http"
```

### Transports

**stdio (default)** - the agent spawns the server as a child process. Nothing is written to stdout except MCP messages; logs go to stderr. The server lives as long as the agent session.

**http** - the server runs standalone and serves [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) MCP at `POST /mcp` on the same port as the extension WebSocket. Use this when the agent is not on the same machine's process tree (remote agents, other devices). Requests must carry `Authorization: Bearer <token>`. Because a restarted server would invalidate the token, pass a fixed `--token` (or `VM_MCP_TOKEN`) in this mode.

```sh
VM_MCP_TOKEN=secret npx @violentmonkey/mcp -p 5678 --transport http
claude mcp add --transport http violentmonkey http://127.0.0.1:5678/mcp --header "Authorization: Bearer secret"
```

Exposing the server beyond localhost (`--host 0.0.0.0`) is your responsibility; put it behind TLS and treat the token as a password. See [docs/security.md](docs/security.md).

## Tools

| Tool | Description | Annotations |
| --- | --- | --- |
| `vm_status` | Whether the extension is connected, its version, and the connect URL. Works even when disconnected. | read-only |
| `scripts_list` | List scripts (id, name, namespace, version, enabled, matches). | read-only |
| `scripts_get` | Get a script's metadata and source code by id. | read-only |
| `scripts_create` | Install a new script from source code. | |
| `scripts_update` | Replace a script's source code. | idempotent |
| `scripts_set_enabled` | Enable or disable a script. | idempotent |
| `scripts_delete` | Remove a script. | destructive |

Exact input/output schemas live in [`packages/protocol`](packages/protocol) and are the single source of truth.

In `--readonly` mode only the read-only tools (`vm_status`, `scripts_list`, `scripts_get`) are exposed.

When the extension is not connected, every tool except `vm_status` returns an MCP error result (`isError: true`) with code `503` and the message `Violentmonkey is not connected`. Over the HTTP transport this is a tool result, not an HTTP status, since the HTTP request itself succeeded.

## Client library

`@violentmonkey/mcp-client` is what Violentmonkey embeds to talk to the server.

```ts
import { createClient } from '@violentmonkey/mcp-client';

const client = createClient({
  port: 5678,
  token,
  info: { name: 'Violentmonkey', version: '2.x' },
});

client.handle('scripts_list', async () => {
  return (await getScripts()).map(toSummary);
});

client.handle('scripts_get', async ({ id }) => getScript(id));

client.on('status', (status) => console.log(status)); // idle | connecting | open | closed

client.connect(); // register all handlers first: they are sent in the handshake
client.close();
```

- `handle(name, fn)` is fully typed from the protocol package (types only, erased at build time). The client does no runtime validation: the server already validates params before forwarding and validates results before returning them, so handlers can trust their input. The client has no runtime dependencies beyond a few constants from `@violentmonkey/mcp-protocol` (about 1.4 KB gzipped).
- Only tools known to the protocol can be handled. The set of handlers registered determines which tools the server exposes (see [docs/design.md](docs/design.md#capabilities)).
- The client reconnects automatically with backoff while the token is still accepted, and sends heartbeats so a Manifest V3 service worker is kept alive.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

Releasing (versions are managed locally; all three packages share one version):

```sh
pnpm changeset            # describe the change (once per change)
pnpm version-packages     # bump versions and update changelogs
jj commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z && git push origin main vX.Y.Z   # pushing the tag publishes to npm via OIDC
```

Layout:

```
packages/
  protocol/   tool schemas + wire types
  server/     @violentmonkey/mcp  (CLI, Hono app, MCP server)
  client/     @violentmonkey/mcp-client
docs/
  design.md   architecture and behavior
  protocol.md WebSocket wire protocol
  security.md threat model
```

## License

MIT
