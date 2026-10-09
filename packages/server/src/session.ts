import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CloseCode,
  ErrorCode,
  PROTOCOL_VERSION,
  ToolCallError,
  type ReadyMessage,
  type ToolName,
} from '@violentmonkey/mcp-protocol';
import { clientMessage, isToolName, tools } from '@violentmonkey/mcp-protocol/schemas';

export interface Peer {
  send(data: string): void;
  close(code: number, reason?: string): void;
}

export interface PeerHandler {
  message(data: string): void;
  close(): void;
}

export interface SessionOptions {
  token: string;
  server: { name: string; version: string };
  callTimeoutMs?: number;
  helloTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface SessionStatus {
  connected: boolean;
  client?: { name: string; version: string };
  tools: ToolName[];
}

interface Connection {
  peer: Peer;
  client: { name: string; version: string };
  tools: Set<ToolName>;
  idleTimer?: NodeJS.Timeout;
}

interface Pending {
  conn: Connection;
  resolve: (value: unknown) => void;
  reject: (error: ToolCallError) => void;
  timer: NodeJS.Timeout;
}

export function safeEqual(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export class Session {
  private conn?: Connection;
  private pending = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private nextId = 0;

  constructor(private options: SessionOptions) {}

  get status(): SessionStatus {
    const { conn } = this;
    return {
      connected: !!conn,
      client: conn?.client,
      tools: conn ? [...conn.tools] : [],
    };
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  accept(peer: Peer): PeerHandler {
    let conn: Connection | undefined;
    let closed = false;

    const helloTimer = setTimeout(() => {
      if (!conn) peer.close(CloseCode.Malformed, 'hello timeout');
    }, this.options.helloTimeoutMs ?? 5000);

    const resetIdle = () => {
      if (!conn) return;
      clearTimeout(conn.idleTimer);
      conn.idleTimer = setTimeout(
        () => peer.close(CloseCode.Closed, 'idle timeout'),
        this.options.idleTimeoutMs ?? 60_000,
      );
    };

    return {
      message: (data) => {
        if (closed) return;
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          peer.close(CloseCode.Malformed, 'invalid json');
          return;
        }
        const parsed = clientMessage.safeParse(json);
        if (!parsed.success) {
          peer.close(CloseCode.Malformed, 'invalid message');
          return;
        }
        const msg = parsed.data;

        if (!conn) {
          if (msg.type !== 'hello') {
            peer.close(CloseCode.Malformed, 'expected hello');
            return;
          }
          clearTimeout(helloTimer);
          if (!safeEqual(msg.token, this.options.token)) {
            peer.close(CloseCode.Unauthorized, 'unauthorized');
            return;
          }
          if (msg.protocol !== PROTOCOL_VERSION) {
            peer.close(CloseCode.UnsupportedVersion, 'unsupported protocol');
            return;
          }
          const accepted = new Set(msg.tools.filter(isToolName));
          conn = { peer, client: msg.client, tools: accepted };
          this.replace(conn);
          const ready: ReadyMessage = {
            type: 'ready',
            protocol: PROTOCOL_VERSION,
            server: this.options.server,
            tools: [...accepted],
          };
          peer.send(JSON.stringify(ready));
          resetIdle();
          return;
        }

        resetIdle();
        switch (msg.type) {
          case 'ping':
            peer.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'result': {
            const entry = this.pending.get(msg.id);
            if (!entry || entry.conn !== conn) return;
            this.pending.delete(msg.id);
            clearTimeout(entry.timer);
            if (msg.ok) entry.resolve(msg.data);
            else entry.reject(new ToolCallError(msg.error.code, msg.error.message));
            break;
          }
          case 'hello':
            peer.close(CloseCode.Malformed, 'unexpected hello');
            break;
        }
      },
      close: () => {
        closed = true;
        clearTimeout(helloTimer);
        if (conn) this.drop(conn);
      },
    };
  }

  private replace(next: Connection) {
    const prev = this.conn;
    this.conn = next;
    if (prev) {
      this.rejectPending(prev, 'Violentmonkey connection was replaced');
      clearTimeout(prev.idleTimer);
      prev.peer.close(CloseCode.Replaced, 'replaced');
    }
    this.emit();
  }

  private drop(conn: Connection) {
    clearTimeout(conn.idleTimer);
    this.rejectPending(conn, 'Violentmonkey disconnected');
    if (this.conn === conn) {
      this.conn = undefined;
      this.emit();
    }
  }

  private rejectPending(conn: Connection, message: string) {
    for (const [id, entry] of this.pending) {
      if (entry.conn !== conn) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new ToolCallError(ErrorCode.NotConnected, message));
    }
  }

  disconnect() {
    this.conn?.peer.close(CloseCode.Closed, 'server closing');
  }

  async callTool(name: ToolName, params: unknown): Promise<unknown> {
    const { conn } = this;
    if (!conn) {
      throw new ToolCallError(ErrorCode.NotConnected, 'Violentmonkey is not connected');
    }
    if (!conn.tools.has(name)) {
      throw new ToolCallError(
        ErrorCode.NotConnected,
        `Connected Violentmonkey does not support ${name}`,
      );
    }
    const id = `c_${++this.nextId}`;
    const data = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolCallError(ErrorCode.Timeout, 'Violentmonkey did not respond in time'));
      }, this.options.callTimeoutMs ?? 30_000);
      this.pending.set(id, { conn, resolve, reject, timer });
      conn.peer.send(JSON.stringify({ type: 'call', id, tool: name, params }));
    });
    const output = tools[name].output.safeParse(data);
    if (!output.success) {
      throw new ToolCallError(
        ErrorCode.BadResponse,
        `Invalid response from Violentmonkey: ${output.error.message}`,
      );
    }
    return output.data;
  }
}
