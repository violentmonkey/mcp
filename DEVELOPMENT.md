# Development

## Packages

| Package | Description |
| --- | --- |
| [`@violentmonkey/mcp`](packages/server) | The server and CLI (`npx @violentmonkey/mcp`). |
| [`@violentmonkey/mcp-client`](packages/client) | Library used by the extension to connect to the server and implement tools. |
| [`@violentmonkey/mcp-protocol`](packages/protocol) | Wire protocol constants and inferred types (root export, no runtime dependencies), plus zod tool schemas (`/schemas`, used by the server). |

## Setup

```sh
pnpm install
pnpm build       # vite builds each package
pnpm typecheck
pnpm test        # vitest end-to-end tests
```

## Releasing

Releases are done manually. Versions are bumped with [changesets](https://github.com/changesets/changesets), and all three packages share one version. No git tags or changelogs are created.

```sh
pnpm changeset            # describe the change
pnpm changeset version    # bump versions and consume changesets
jj commit -m "chore: release vX.Y.Z"
pnpm build
pnpm -r publish --access public --no-git-checks
jj git push
```

`pnpm -r publish` skips versions that are already on npm. Do not run `changeset publish` or `changeset tag`: they create per-package git tags.

## Layout

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

## Client library (for the extension)

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
