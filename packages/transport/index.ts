import type { ServerWebSocket } from 'bun';
import { encodeMessage, decodeMessage, type RdpMessage } from '../core-protocol';

export type ClientId = string;

export interface TransportClient {
  id: ClientId;
  ws: ServerWebSocket<{ id: ClientId }>;
  authenticated: boolean;
}

/**
 * WebSocket transport layer — Bun native
 */
export class WsTransport {
  private clients = new Map<ClientId, TransportClient>();
  private onMessage?: (clientId: ClientId, msg: RdpMessage) => void;
  private onConnect?: (clientId: ClientId) => void;
  private onDisconnect?: (clientId: ClientId) => void;

  constructor(private port = 9001) {}

  start() {
    Bun.serve({
      port: this.port,
      websocket: {
        open: (ws) => {
          const client: TransportClient = { id: ws.data.id, ws, authenticated: false };
          this.clients.set(ws.data.id, client);
          this.onConnect?.(ws.data.id);
          console.log(`[transport] Client connected: ${ws.data.id}`);
        },
        message: (ws, raw) => {
          const buf = typeof raw === 'string'
            ? new TextEncoder().encode(raw)
            : new Uint8Array(raw);
          const msg = decodeMessage(buf);
          this.onMessage?.(ws.data.id, msg);
        },
        close: (ws) => {
          this.clients.delete(ws.data.id);
          this.onDisconnect?.(ws.data.id);
          console.log(`[transport] Client disconnected: ${ws.data.id}`);
        },
      },
      fetch(req, server) {
        const id = crypto.randomUUID();
        if (server.upgrade(req, { data: { id } })) return;
        return new Response('bun-rdp server', { status: 200 });
      },
    });
    console.log(`[transport] Listening on ws://localhost:${this.port}`);
  }

  send(clientId: ClientId, msg: RdpMessage) {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.ws.sendBinary(encodeMessage(msg));
  }

  broadcast(msg: RdpMessage) {
    const encoded = encodeMessage(msg);
    for (const client of this.clients.values()) {
      if (client.authenticated) client.ws.sendBinary(encoded);
    }
  }

  setAuthenticated(clientId: ClientId) {
    const c = this.clients.get(clientId);
    if (c) c.authenticated = true;
  }

  on(event: 'message', cb: (clientId: ClientId, msg: RdpMessage) => void): void;
  on(event: 'connect' | 'disconnect', cb: (clientId: ClientId) => void): void;
  on(event: string, cb: unknown) {
    if (event === 'message') this.onMessage = cb as typeof this.onMessage;
    if (event === 'connect') this.onConnect = cb as typeof this.onConnect;
    if (event === 'disconnect') this.onDisconnect = cb as typeof this.onDisconnect;
  }
}
