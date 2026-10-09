# @violentmonkey/mcp-client

Tiny, dependency-free client that Violentmonkey uses to connect to [`@violentmonkey/mcp`](https://www.npmjs.com/package/@violentmonkey/mcp) and implement its tools.

```ts
import { createClient } from '@violentmonkey/mcp-client';

const client = createClient({ port, token, info: { name: 'Violentmonkey', version } });
client.handle('scripts_list', async () => ({ scripts: [] }));
client.connect();
```

The client does no runtime validation; the server validates params and results. See the [development guide](https://github.com/violentmonkey/mcp/blob/main/DEVELOPMENT.md#client-library-for-the-extension).
