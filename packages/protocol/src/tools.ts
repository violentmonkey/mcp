import { z } from 'zod';

export const scriptSummary = z.object({
  id: z.number().int(),
  name: z.string(),
  namespace: z.string().optional(),
  version: z.string().optional(),
  enabled: z.boolean(),
  matches: z.array(z.string()),
});

export const scriptDetail = scriptSummary.extend({
  code: z.string(),
});

export const tabSummary = z.object({
  tabId: z.number().int(),
  url: z.string(),
  title: z.string(),
});

export const tabScript = z.object({
  id: z.number().int(),
  name: z.string(),
  version: z.string().optional(),
  runAt: z.string().describe('Value of @run-at, e.g. "document-start"'),
  frameId: z.number().int(),
  status: z.enum(['injected', 'failed', 'pending']),
  error: z.string().optional().describe('Present when status is "failed"'),
  codeHash: z.string().optional().describe('Identifies the injected source'),
});

export const logEntry = z.object({
  seq: z.number().int(),
  time: z.number().int().describe('Milliseconds since the epoch'),
  scriptId: z.number().int(),
  text: z.string(),
  truncated: z.boolean().optional(),
  count: z.number().int().optional().describe('Number of identical consecutive lines collapsed'),
});

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ToolDefinition<I extends z.ZodObject, O extends z.ZodObject> {
  title: string;
  description: string;
  input: I;
  output: O;
  annotations: ToolAnnotations;
}

function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  tool: ToolDefinition<I, O>,
) {
  return tool;
}

const scriptId = z.number().int().describe('Script id as returned by scripts_list');
const tabId = z.number().int().describe('Tab id as returned by tabs_list');

export const tools = {
  scripts_list: defineTool({
    title: 'List scripts',
    description: 'List installed userscripts, optionally filtered by a name substring.',
    input: z.object({
      query: z.string().optional().describe('Case-insensitive name filter'),
    }),
    output: z.object({ scripts: z.array(scriptSummary) }),
    annotations: { readOnlyHint: true },
  }),
  scripts_get: defineTool({
    title: 'Get script',
    description: 'Get a userscript with its metadata and full source code.',
    input: z.object({ id: scriptId }),
    output: z.object({ script: scriptDetail }),
    annotations: { readOnlyHint: true },
  }),
  scripts_write: defineTool({
    title: 'Write script',
    description:
      'Create or update a userscript from source code. The code must include a ==UserScript== metadata block. ' +
      'With `id`, that script is updated. Without `id`, a script with the same @name and @namespace is updated, otherwise a new script is created.',
    input: z.object({
      code: z.string().min(1),
      id: scriptId.optional(),
      enabled: z.boolean().optional().describe('Defaults to the current state, or true for new scripts'),
    }),
    output: z.object({
      script: scriptSummary,
      created: z.boolean().describe('Whether a new script was created'),
    }),
    annotations: { idempotentHint: true },
  }),
  scripts_set_enabled: defineTool({
    title: 'Enable or disable script',
    description: 'Enable or disable a userscript.',
    input: z.object({ id: scriptId, enabled: z.boolean() }),
    output: z.object({ script: scriptSummary }),
    annotations: { idempotentHint: true },
  }),
  scripts_delete: defineTool({
    title: 'Delete script',
    description: 'Permanently remove a userscript.',
    input: z.object({ id: scriptId }),
    output: z.object({ id: z.number().int() }),
    annotations: { destructiveHint: true },
  }),
  tabs_list: defineTool({
    title: 'List granted tabs',
    description:
      'List the browser tabs the user has granted to the agent. Empty until the user grants a tab in Violentmonkey; ' +
      'when empty, call vm_status and give the user the URL it returns.',
    input: z.object({}),
    output: z.object({ tabs: z.array(tabSummary) }),
    annotations: { readOnlyHint: true },
  }),
  tab_scripts: defineTool({
    title: 'List scripts injected in a tab',
    description:
      'Report what Violentmonkey attempted to run on a granted tab, including scripts that failed to inject. ' +
      'A script missing from the list did not run; use scripts_list and scripts_test_match to find out why.',
    input: z.object({ tabId }),
    output: z.object({
      url: z.string(),
      loadId: z.string().describe('Identifies the document these results came from'),
      scripts: z.array(tabScript),
    }),
    annotations: { readOnlyHint: true },
  }),
  tab_reload: defineTool({
    title: 'Reload tab',
    description:
      'Reload a granted tab so Violentmonkey re-injects its scripts. Returns the new loadId, ' +
      'which can be passed to script_logs as sinceLoadId.',
    input: z.object({ tabId }),
    output: z.object({
      tabId: z.number().int(),
      url: z.string(),
      loadId: z.string(),
    }),
    annotations: { idempotentHint: true },
  }),
  script_logs: defineTool({
    title: 'Read script logs',
    description:
      'Read what a userscript logged with GM_log on a granted tab. The script must declare @grant GM_log. ' +
      'Logs are captured only while Violentmonkey is connected. Poll with afterSeq, or pass sinceLoadId to read one document.',
    input: z.object({
      tabId,
      scriptId: scriptId.optional(),
      afterSeq: z.number().int().optional().describe('Return entries with seq greater than this'),
      sinceLoadId: z.string().optional().describe('Only entries from this document load'),
      limit: z.number().int().min(1).max(500).optional().describe('Default 200, max 500'),
    }),
    output: z.object({
      entries: z.array(logEntry),
      nextSeq: z.number().int().describe('Pass as afterSeq to poll for newer entries'),
      dropped: z.number().int().describe('Entries evicted from the buffer since the last call'),
    }),
    annotations: { readOnlyHint: true },
  }),
  scripts_test_match: defineTool({
    title: 'Test script match',
    description:
      'Ask whether a userscript would be injected at a URL, using the same matcher Violentmonkey uses. ' +
      'Takes full source rather than an id, so it works before the script is installed.',
    input: z.object({
      code: z
        .string()
        .min(1)
        .describe('Userscript source, including the ==UserScript== metadata block'),
      url: z.string().describe('Full page URL, including any query string or fragment'),
    }),
    output: z.object({
      matched: z.boolean(),
      rule: z
        .string()
        .optional()
        .describe('The @match/@include/@exclude pattern that decided the result'),
      tried: z.array(z.string()).describe('Every URL rule evaluated, in order'),
    }),
    annotations: { readOnlyHint: true },
  }),
} as const;

export type Tools = typeof tools;
export type ToolName = keyof Tools;
export type ToolInput<N extends ToolName> = z.infer<Tools[N]['input']>;
export type ToolOutput<N extends ToolName> = z.infer<Tools[N]['output']>;

export const toolNames = Object.keys(tools) as ToolName[];

export function isReadOnlyTool(name: ToolName) {
  return tools[name].annotations.readOnlyHint === true;
}

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(tools, name);
}
