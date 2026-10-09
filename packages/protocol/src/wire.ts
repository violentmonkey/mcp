import { z } from 'zod';

const peerInfo = z.object({ name: z.string(), version: z.string() });

export const helloMessage = z.object({
  type: z.literal('hello'),
  protocol: z.number().int(),
  token: z.string(),
  client: peerInfo,
  tools: z.array(z.string()),
});

export const readyMessage = z.object({
  type: z.literal('ready'),
  protocol: z.number().int(),
  server: peerInfo,
  tools: z.array(z.string()),
});

export const callMessage = z.object({
  type: z.literal('call'),
  id: z.string(),
  tool: z.string(),
  params: z.unknown(),
});

export const toolError = z.object({ code: z.number().int(), message: z.string() });

export const resultMessage = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('result'), id: z.string(), ok: z.literal(true), data: z.unknown() }),
  z.object({ type: z.literal('result'), id: z.string(), ok: z.literal(false), error: toolError }),
]);

export const pingMessage = z.object({ type: z.literal('ping') });
export const pongMessage = z.object({ type: z.literal('pong') });

export const clientMessage = z.union([helloMessage, resultMessage, pingMessage]);
export const serverMessage = z.union([readyMessage, callMessage, pongMessage]);

export type HelloMessage = z.infer<typeof helloMessage>;
export type ReadyMessage = z.infer<typeof readyMessage>;
export type CallMessage = z.infer<typeof callMessage>;
export type ResultMessage = z.infer<typeof resultMessage>;
export type ClientMessage = z.infer<typeof clientMessage>;
export type ServerMessage = z.infer<typeof serverMessage>;
