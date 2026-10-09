import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBridge } from './bridge';
import { createMcpServer } from './mcp';
import { Session } from './session';

export interface StartOptions {
  port: number;
  host?: string;
  token?: string;
  transport?: 'stdio' | 'http';
  allowNoOrigin?: boolean;
  callTimeoutMs?: number;
}

export interface RunningServer {
  token: string;
  connectUrl: string;
  session: Session;
  close(): Promise<void>;
}

export function readVersion() {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const pkg: { version?: string } = JSON.parse(raw);
  return pkg.version ?? '0.0.0';
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const host = options.host ?? '127.0.0.1';
  const transport = options.transport ?? 'stdio';
  const token = options.token ?? randomBytes(32).toString('base64url');
  const version = readVersion();
  const connectUrl = `https://violentmonkey.github.io/mcp_connect.html?port=${options.port}&token=${token}`;

  const session = new Session({
    token,
    server: { name: '@violentmonkey/mcp', version },
    callTimeoutMs: options.callTimeoutMs,
  });

  const bridge = createBridge({
    session,
    host,
    mcp: { version, connectUrl },
    token,
    httpTransport: transport === 'http',
    allowNoOrigin: options.allowNoOrigin,
  });

  const httpServer = await new Promise<Server>((resolve, reject) => {
    const listening = serve({ fetch: bridge.app.fetch, port: options.port, hostname: host });
    listening.once('error', reject);
    listening.once('listening', () => resolve(listening as Server));
  });
  bridge.injectWebSocket(httpServer);

  let stdioClose: (() => Promise<void>) | undefined;
  if (transport === 'stdio') {
    const { server, dispose } = createMcpServer(session, { version, connectUrl });
    await server.connect(new StdioServerTransport());
    stdioClose = async () => {
      dispose();
      await server.close();
    };
  }

  return {
    token,
    connectUrl,
    session,
    async close() {
      session.disconnect();
      await stdioClose?.();
      await bridge.closeTransports();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
    },
  };
}
