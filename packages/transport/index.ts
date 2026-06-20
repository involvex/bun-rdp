import type { ServerWebSocket, TLSOptions } from 'bun';
import { AuditLogger } from '../audit';
import { type RdpMessage, decodeMessage, encodeMessage } from '../core-protocol';
import { IPAllowlist } from '../security/ip-allowlist';
import { RateLimiter } from '../security/rate-limiter';

export type ClientId = string;

export interface TransportClient {
  id: ClientId;
  ip: string;
  ws: ServerWebSocket<{ id: ClientId; ip: string }>;
  authenticated: boolean;
  sessionId?: string;
  connectedAt: number;
}

export class WsTransport {
  private clients = new Map<ClientId, TransportClient>();
  private onMessage?: (id: ClientId, msg: RdpMessage) => void;
  private onConnect?: (id: ClientId, ip: string) => void;
  private onDisconnect?: (id: ClientId, ip: string) => void;

  private allowlist = new IPAllowlist();
  private limiter = new RateLimiter();
  readonly audit = new AuditLogger();

  constructor(
    private port = 9001,
    private tls?: TLSOptions
  ) {}

  start(): void {
    Bun.serve({
      port: this.port,
      tls: this.tls,
      websocket: {
        open: (ws) => {
          const client: TransportClient = {
            id: ws.data.id,
            ip: ws.data.ip,
            ws,
            authenticated: false,
            connectedAt: Date.now(),
          };
          this.clients.set(ws.data.id, client);
          this.audit.connect(ws.data.ip, ws.data.id);
          this.onConnect?.(ws.data.id, ws.data.ip);
        },
        message: (ws, raw) => {
          const buf = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw);
          try {
            const msg = decodeMessage(buf);
            this.onMessage?.(ws.data.id, msg);
          } catch {
            /* malformed message */
          }
        },
        close: (ws) => {
          const client = this.clients.get(ws.data.id);
          this.clients.delete(ws.data.id);
          this.audit.disconnect(ws.data.ip, ws.data.id);
          this.onDisconnect?.(ws.data.id, ws.data.ip ?? '');
        },
      },
      fetch: (req, server) => {
        // Extract real IP (supports X-Forwarded-For behind reverse proxy)
        const ip =
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          req.headers.get('x-real-ip') ??
          server.requestIP(req)?.address ??
          '0.0.0.0';

        // IP allowlist check
        if (!this.allowlist.isAllowed(ip)) {
          this.audit.ipBlocked(ip);
          return new Response('Forbidden', { status: 403 });
        }

        // Rate limit check
        if (!this.limiter.checkConnection(ip)) {
          this.audit.rateLimited(ip, 'connection flood');
          return new Response('Too Many Requests', { status: 429 });
        }

        const id = crypto.randomUUID();
        if (server.upgrade(req, { data: { id, ip } })) return;
        return new Response(this.tls ? 'bun-rdp (TLS)' : 'bun-rdp', { status: 200 });
      },
    });

    const proto = this.tls ? 'wss' : 'ws';
    console.log(`[transport] ${proto}://localhost:${this.port}`);
  }

  send(clientId: ClientId, msg: RdpMessage): void {
    this.clients.get(clientId)?.ws.sendBinary(encodeMessage(msg));
  }

  broadcast(msg: RdpMessage): void {
    const encoded = encodeMessage(msg);
    for (const c of this.clients.values()) {
      if (c.authenticated) c.ws.sendBinary(encoded);
    }
  }

  setAuthenticated(clientId: ClientId, sessionId: string): void {
    const c = this.clients.get(clientId);
    if (!c) return;
    c.authenticated = true;
    c.sessionId = sessionId;
  }

  recordAuthFail(ip: string, clientId: string): boolean {
    return this.limiter.recordAuthFail(ip);
  }

  getClientIp(clientId: ClientId): string {
    return this.clients.get(clientId)?.ip ?? '0.0.0.0';
  }

  on(event: 'message', cb: (id: ClientId, msg: RdpMessage) => void): void;
  on(event: 'connect', cb: (id: ClientId, ip: string) => void): void;
  on(event: 'disconnect', cb: (id: ClientId, ip: string) => void): void;
  on(event: string, cb: unknown): void {
    if (event === 'message') this.onMessage = cb as typeof this.onMessage;
    if (event === 'connect') this.onConnect = cb as typeof this.onConnect;
    if (event === 'disconnect') this.onDisconnect = cb as typeof this.onDisconnect;
  }

  get connectedCount(): number {
    return this.clients.size;
  }
}
