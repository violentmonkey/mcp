import { parseArgs } from 'node:util';
import { startServer } from './server';

const HELP = `Usage: mcp [options]

  -p, --port <number>      Port for the extension (and HTTP transport). Default: 5678
      --host <host>        Bind address. Default: 127.0.0.1
      --token <string>     Fixed token instead of a generated one. Env: VM_MCP_TOKEN
      --transport <type>   MCP transport: "stdio" (default) or "http"
  -h, --help               Show this help
`;

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', short: 'p', default: '5678' },
      host: { type: 'string', default: '127.0.0.1' },
      token: { type: 'string' },
      transport: { type: 'string', default: 'stdio' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stderr.write(HELP);
    return;
  }

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${values.port}`);
  }
  if (values.transport !== 'stdio' && values.transport !== 'http') {
    throw new Error(`Invalid transport: ${values.transport}`);
  }
  const host = values.host;
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!loopback) {
    process.stderr.write(
      `Warning: binding to ${host}. Anyone who can reach this port and has the token can control your scripts.\n`,
    );
  }

  const running = await startServer({
    port,
    host,
    token: values.token ?? process.env.VM_MCP_TOKEN,
    transport: values.transport,
  });

  process.stderr.write(
    `Violentmonkey MCP listening on ${host}:${port} (${values.transport})\n` +
      `Open this URL in your browser to connect Violentmonkey:\n${running.connectUrl}\n`,
  );

  const shutdown = () => {
    void running.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdin.once('end', shutdown);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
