import { randomUUID } from 'node:crypto';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer, type McpOptions } from './mcp';
import { safeEqual, type Session } from './session';

export interface BridgeOptions {
  session: Session;
  host: string;
  mcp: McpOptions;
  token: string;
  httpTransport: boolean;
  allowNoOrigin?: boolean;
}

const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|extension|safari-web-extension):\/\//;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostname(hostHeader: string) {
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hostHeader);
  return match?.[1]?.toLowerCase();
}

export function createBridge(options: BridgeOptions) {
  const { session } = options;
  const app = new Hono();
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  const allowedHosts = new Set([...LOOPBACK_HOSTS, options.host.toLowerCase()]);
  const wildcardBind = options.host === '0.0.0.0' || options.host === '::';

  app.use('*', async (c, next) => {
    const name = hostname(c.req.header('host') ?? '');
    if (!wildcardBind && (!name || !allowedHosts.has(name))) {
      return c.text('Forbidden host', 403);
    }
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.get(
    '/ws',
    async (c, next) => {
      const origin = c.req.header('origin');
      const allowed = origin ? EXTENSION_ORIGIN.test(origin) : !!options.allowNoOrigin;
      if (!allowed) return c.text('Forbidden origin', 403);
      await next();
    },
    upgradeWebSocket(() => {
      let handler: ReturnType<Session['accept']> | undefined;
      return {
        onOpen: (_event, ws) => {
          handler = session.accept({
            send: (data) => ws.send(data),
            close: (code, reason) => ws.close(code, reason),
          });
        },
        onMessage: (event) => {
          if (typeof event.data === 'string') handler?.message(event.data);
        },
        onClose: () => handler?.close(),
        onError: () => handler?.close(),
      };
    }),
  );

  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  if (options.httpTransport) {
    app.all('/mcp', async (c) => {
      const auth = c.req.header('authorization') ?? '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!safeEqual(bearer, options.token)) {
        return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Bearer' });
      }

      const sessionId = c.req.header('mcp-session-id');
      const existing = sessionId ? transports.get(sessionId) : undefined;
      if (existing) return existing.handleRequest(c.req.raw);
      if (sessionId) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null },
          404,
        );
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });
      const { server, dispose } = createMcpServer(session, options.mcp);
      server.server.onclose = () => {
        dispose();
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      await server.connect(transport);
      return transport.handleRequest(c.req.raw);
    });
  }

  return {
    app,
    injectWebSocket,
    async closeTransports() {
      await Promise.all([...transports.values()].map((t) => t.close()));
    },
  };
}
