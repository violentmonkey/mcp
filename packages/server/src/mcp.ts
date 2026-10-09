import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode, ToolCallError } from '@violentmonkey/mcp-protocol';
import { toolNames, tools } from '@violentmonkey/mcp-protocol/schemas';
import { z } from 'zod';
import type { Session } from './session';

export interface McpOptions {
  version: string;
  connectUrl: string;
}

const statusOutput = z.object({
  connected: z.boolean(),
  readonly: z.boolean(),
  client: z.object({ name: z.string(), version: z.string() }).optional(),
  tools: z.array(z.string()),
  serverVersion: z.string(),
  connectUrl: z.string(),
});

function errorResult(code: number, message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: `[${code}] ${message}` }] };
}

export function createMcpServer(session: Session, options: McpOptions) {
  const server = new McpServer({ name: '@violentmonkey/mcp', version: options.version });

  server.registerTool(
    'vm_status',
    {
      title: 'Violentmonkey status',
      description:
        'Check whether Violentmonkey is connected. If not, returns a URL the user must open in their browser to authorize the connection.',
      inputSchema: z.object({}),
      outputSchema: statusOutput,
      annotations: { readOnlyHint: true },
    },
    () => {
      const status = session.status;
      const structuredContent = {
        ...status,
        serverVersion: options.version,
        connectUrl: options.connectUrl,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    },
  );

  const registered = toolNames.filter((name) => session.isAllowed(name)).map((name) => {
    const def = tools[name];
    return {
      name,
      tool: server.registerTool(
        name,
        {
          title: def.title,
          description: def.description,
          inputSchema: def.input,
          outputSchema: def.output,
          annotations: def.annotations,
        },
        async (args: unknown): Promise<CallToolResult> => {
          try {
            const structuredContent = await session.callTool(name, args);
            return {
              content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
              structuredContent: z.record(z.string(), z.unknown()).parse(structuredContent),
            };
          } catch (e) {
            if (e instanceof ToolCallError) return errorResult(e.code, e.message);
            return errorResult(ErrorCode.Internal, e instanceof Error ? e.message : String(e));
          }
        },
      ),
    };
  });

  const sync = () => {
    const { connected, tools: accepted } = session.status;
    for (const { name, tool } of registered) {
      const enabled = !connected || accepted.includes(name);
      if (enabled !== tool.enabled) {
        if (enabled) tool.enable();
        else tool.disable();
      }
    }
  };
  sync();
  const unsubscribe = session.onChange(sync);

  return { server, dispose: unsubscribe };
}
