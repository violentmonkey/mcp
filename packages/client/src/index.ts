import {
  CloseCode,
  ErrorCode,
  PROTOCOL_VERSION,
  ToolCallError,
  type ServerMessage,
  type ToolInput,
  type ToolName,
  type ToolOutput,
} from '@violentmonkey/mcp-protocol';

export type ClientStatus = 'idle' | 'connecting' | 'open' | 'closed';

export type ToolHandler<N extends ToolName> = (
  params: ToolInput<N>,
) => ToolOutput<N> | Promise<ToolOutput<N>>;

type SocketLike = Pick<
  WebSocket,
  'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'
>;

export interface ClientOptions {
  port: number;
  token: string;
  host?: string;
  info: { name: string; version: string };
  WebSocket?: new (url: string) => SocketLike;
  heartbeatMs?: number;
  reconnect?: { minMs?: number; maxMs?: number };
}

const TERMINAL_CODES = new Set<number>(Object.values(CloseCode));

export function createClient(options: ClientOptions) {
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const minDelay = options.reconnect?.minMs ?? 1000;
  const maxDelay = options.reconnect?.maxMs ?? 30_000;
  const url = `ws://${options.host ?? '127.0.0.1'}:${options.port}/ws`;

  const handlers = new Map<string, (params: any) => unknown>();
  const listeners = new Set<(status: ClientStatus) => void>();
  let status: ClientStatus = 'idle';
  let closeCode: number | undefined;
  let socket: SocketLike | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let lastSeen = 0;
  let stopped = true;

  function setStatus(next: ClientStatus) {
    if (status === next) return;
    status = next;
    for (const listener of listeners) listener(next);
  }

  function stopHeartbeat() {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }

  function scheduleReconnect() {
    const delay = Math.min(maxDelay, minDelay * 2 ** attempts);
    attempts += 1;
    retryTimer = setTimeout(open, delay);
  }

  async function runCall(ws: SocketLike, id: string, tool: string, params: unknown) {
    const reply = (body: object) => ws.send(JSON.stringify({ type: 'result', id, ...body }));
    const handler = handlers.get(tool);
    if (!handler) {
      return reply({
        ok: false,
        error: { code: ErrorCode.NotFound, message: `Tool ${tool} is not supported` },
      });
    }
    try {
      reply({ ok: true, data: await handler(params) });
    } catch (e) {
      const error =
        e instanceof ToolCallError
          ? { code: e.code, message: e.message }
          : { code: ErrorCode.Internal, message: e instanceof Error ? e.message : String(e) };
      reply({ ok: false, error });
    }
  }

  function open() {
    if (stopped) return;
    setStatus('connecting');
    const Impl = options.WebSocket ?? WebSocket;
    const ws = new Impl(url);
    socket = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          token: options.token,
          client: options.info,
          tools: [...handlers.keys()],
        }),
      );
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      lastSeen = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        attempts = 0;
        setStatus('open');
        stopHeartbeat();
        heartbeat = setInterval(() => {
          if (Date.now() - lastSeen > heartbeatMs * 3) {
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: 'ping' }));
        }, heartbeatMs);
      } else if (msg.type === 'call') {
        void runCall(ws, msg.id, msg.tool, msg.params);
      }
    };

    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = undefined;
      stopHeartbeat();
      if (stopped) return;
      if (TERMINAL_CODES.has(event.code)) {
        stopped = true;
        closeCode = event.code;
        setStatus('closed');
        return;
      }
      setStatus('connecting');
      scheduleReconnect();
    };
  }

  return {
    get status() {
      return status;
    },
    get closeCode() {
      return closeCode;
    },
    handle<N extends ToolName>(name: N, handler: ToolHandler<N>) {
      handlers.set(name, handler);
    },
    on(event: 'status', listener: (status: ClientStatus) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect() {
      if (!stopped) return;
      stopped = false;
      closeCode = undefined;
      attempts = 0;
      lastSeen = Date.now();
      open();
    },
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      stopHeartbeat();
      const ws = socket;
      socket = undefined;
      ws?.close(CloseCode.Closed, 'client closing');
      setStatus('closed');
    },
  };
}

export type McpClient = ReturnType<typeof createClient>;
export { ToolCallError, ErrorCode } from '@violentmonkey/mcp-protocol';
