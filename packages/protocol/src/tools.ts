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
