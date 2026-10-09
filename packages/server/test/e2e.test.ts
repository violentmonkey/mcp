import { request } from 'node:http';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createClient, ToolCallError, type McpClient } from '@violentmonkey/mcp-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/index';

const TOKEN = 'test-token';

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(check: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const summary = { id: 1, name: 'demo', enabled: true, matches: ['*://example.com/*'] };

describe('violentmonkey mcp', () => {
  let port: number;
  let server: RunningServer;
  let mcp: Client;
  const extensions: McpClient[] = [];

  function extension(token = TOKEN) {
    const ext = createClient({ port, token, info: { name: 'test', version: '1' } });
    extensions.push(ext);
    return ext;
  }

  beforeEach(async () => {
    port = await freePort();
    server = await startServer({
      port,
      token: TOKEN,
      transport: 'http',
      allowNoOrigin: true,
      callTimeoutMs: 500,
    });
    mcp = new Client({ name: 'agent', version: '1' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
  });

  afterEach(async () => {
    for (const ext of extensions.splice(0)) ext.close();
    await mcp.close();
    await server.close();
  });

  it('reports disconnected status and returns 503 on tool calls', async () => {
    const status = await mcp.callTool({ name: 'vm_status', arguments: {} });
    expect(status.structuredContent).toMatchObject({ connected: false });

    const res = await mcp.callTool({ name: 'scripts_list', arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([
      { type: 'text', text: '[503] Violentmonkey is not connected' },
    ]);
  });

  it('forwards tool calls to the extension', async () => {
    const ext = extension();
    ext.handle('scripts_list', ({ query }) => ({
      scripts: query === 'none' ? [] : [summary],
    }));
    ext.connect();
    await waitFor(() => ext.status === 'open');

    const status = await mcp.callTool({ name: 'vm_status', arguments: {} });
    expect(status.structuredContent).toMatchObject({
      connected: true,
      tools: ['scripts_list'],
    });

    const res = await mcp.callTool({ name: 'scripts_list', arguments: {} });
    expect(res.structuredContent).toEqual({ scripts: [summary] });
  });

  it('forwards scripts_write and returns whether the script was created', async () => {
    const ext = extension();
    ext.handle('scripts_write', ({ id }) => ({ script: { ...summary, id: id ?? 7 }, created: id === undefined }));
    ext.connect();
    await waitFor(() => ext.status === 'open');

    const code = '// ==UserScript==\n// @name demo\n// ==/UserScript==';
    const created = await mcp.callTool({ name: 'scripts_write', arguments: { code } });
    expect(created.structuredContent).toMatchObject({ created: true, script: { id: 7 } });
    const updated = await mcp.callTool({ name: 'scripts_write', arguments: { code, id: 1 } });
    expect(updated.structuredContent).toMatchObject({ created: false, script: { id: 1 } });
  });

  it('only lists tools supported by the extension while connected', async () => {
    const ext = extension();
    ext.handle('scripts_list', () => ({ scripts: [] }));
    ext.connect();
    await waitFor(() => ext.status === 'open');
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['scripts_list', 'vm_status']);
  });

  it('propagates handler errors and validates params', async () => {
    const ext = extension();
    ext.handle('scripts_get', () => {
      throw new ToolCallError(404, 'Script 9 not found');
    });
    ext.connect();
    await waitFor(() => ext.status === 'open');

    const res = await mcp.callTool({ name: 'scripts_get', arguments: { id: 9 } });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: 'text', text: '[404] Script 9 not found' }]);
  });

  it('returns 502 when the extension violates the output schema', async () => {
    const ext = extension();
    ext.handle('scripts_list', () => ({ scripts: 'nope' }) as never);
    ext.connect();
    await waitFor(() => ext.status === 'open');
    const res = await mcp.callTool({ name: 'scripts_list', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('[502]');
  });

  it('times out with 504', async () => {
    const ext = extension();
    ext.handle('scripts_list', () => new Promise(() => {}));
    ext.connect();
    await waitFor(() => ext.status === 'open');
    const res = await mcp.callTool({ name: 'scripts_list', arguments: {} });
    expect(JSON.stringify(res.content)).toContain('[504]');
  });

  it('returns 503 when the extension disconnects mid-call', async () => {
    const ext = extension();
    ext.handle('scripts_list', () => new Promise(() => {}));
    ext.connect();
    await waitFor(() => ext.status === 'open');
    const call = mcp.callTool({ name: 'scripts_list', arguments: {} });
    await new Promise((r) => setTimeout(r, 50));
    ext.close();
    const res = await call;
    expect(JSON.stringify(res.content)).toContain('[503]');
  });

  it('replaces the existing connection when a new one authenticates', async () => {
    const first = extension();
    first.handle('scripts_list', () => ({ scripts: [] }));
    first.connect();
    await waitFor(() => first.status === 'open');

    const second = extension();
    second.handle('scripts_list', () => ({ scripts: [summary] }));
    second.connect();
    await waitFor(() => second.status === 'open');
    await waitFor(() => first.status === 'closed');
    expect(first.closeCode).toBe(4001);

    const res = await mcp.callTool({ name: 'scripts_list', arguments: {} });
    expect(res.structuredContent).toEqual({ scripts: [summary] });
  });

  it('rejects a bad token without affecting the active connection', async () => {
    const good = extension();
    good.handle('scripts_list', () => ({ scripts: [] }));
    good.connect();
    await waitFor(() => good.status === 'open');

    const bad = extension('wrong');
    bad.connect();
    await waitFor(() => bad.status === 'closed');
    expect(bad.closeCode).toBe(4003);
    expect(good.status).toBe('open');
  });

  it('requires a bearer token on /mcp', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/health', headers: { Host: 'evil.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.once('error', reject);
      req.end();
    });
    expect(status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  });
});

describe('origin check', () => {
  it('rejects websocket upgrades without an extension origin', async () => {
    const port = await freePort();
    const server = await startServer({ port, token: TOKEN, transport: 'http' });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ws`, {
        headers: { Origin: 'https://evil.example' },
      });
      expect(res.status).toBe(403);
    } finally {
      await server.close();
    }
  });
});

describe('read-only mode', () => {
  it('hides write tools and never forwards them', async () => {
    const port = await freePort();
    const server = await startServer({
      port,
      token: TOKEN,
      transport: 'http',
      allowNoOrigin: true,
      readonly: true,
    });
    const mcp = new Client({ name: 'agent', version: '1' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    const ext = createClient({ port, token: TOKEN, info: { name: 'test', version: '1' } });
    ext.handle('scripts_list', () => ({ scripts: [] }));
    ext.handle('scripts_delete', ({ id }) => ({ id }));
    ext.handle('scripts_write', () => ({ script: summary, created: false }));
    try {
      const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(['scripts_get', 'scripts_list', 'vm_status']);

      ext.connect();
      await waitFor(() => ext.status === 'open');
      const status = await mcp.callTool({ name: 'vm_status', arguments: {} });
      expect(status.structuredContent).toMatchObject({
        readonly: true,
        tools: ['scripts_list'],
      });
      const res = await mcp.callTool({ name: 'scripts_delete', arguments: { id: 1 } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain('not found');
    } finally {
      ext.close();
      await mcp.close();
      await server.close();
    }
  });
});
