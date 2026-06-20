/**
 * Audit log — structured event log for all security-relevant actions.
 *
 * Events are written to:
 *   1. A rotating JSON-lines file  (.rdp-data/audit.log)
 *   2. Console (info level)
 *
 * Swap the FileAuditWriter for a database writer in production.
 */
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Event types ──────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'connect' // new WebSocket connection
  | 'disconnect' // connection closed
  | 'auth_ok' // successful authentication
  | 'auth_fail' // failed authentication
  | 'token_refresh' // session token refreshed
  | 'ip_blocked' // connection rejected by allowlist
  | 'rate_limited' // connection rejected by rate limiter
  | 'clipboard_in' // client sent clipboard data
  | 'clipboard_out' // server sent clipboard data
  | 'session_start' // authenticated session began streaming
  | 'session_end'; // session ended

export interface AuditEvent {
  id: string;
  ts: string; // ISO-8601
  type: AuditEventType;
  ip?: string;
  clientId?: string;
  sessionId?: string;
  detail?: string;
  durationMs?: number;
}

// ─── Writers ──────────────────────────────────────────────────────────────────

export interface AuditWriter {
  write(event: AuditEvent): void;
}

export class FileAuditWriter implements AuditWriter {
  private path: string;

  constructor(dir = process.env.BUN_RDP_DATA_DIR ?? join(process.cwd(), '.rdp-data')) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'audit.log');
  }

  write(event: AuditEvent): void {
    appendFileSync(this.path, JSON.stringify(event) + '\n', 'utf8');
  }
}

// ─── AuditLogger ──────────────────────────────────────────────────────────────

export class AuditLogger {
  private writers: AuditWriter[];
  private sessionStarts = new Map<string, number>(); // clientId → startTime

  constructor(...writers: AuditWriter[]) {
    this.writers = writers.length > 0 ? writers : [new FileAuditWriter()];
  }

  log(type: AuditEventType, fields: Omit<AuditEvent, 'id' | 'ts' | 'type'>): void {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      type,
      ...fields,
    };
    for (const w of this.writers) w.write(event);
    console.log(
      `[audit] ${event.ts} ${type.padEnd(14)} ${fields.ip ?? ''} ${fields.clientId?.slice(0, 8) ?? ''} ${fields.detail ?? ''}`
    );
  }

  // ── Convenience helpers ───────────────────────────────────────────────────

  connect(ip: string, clientId: string): void {
    this.log('connect', { ip, clientId });
  }

  disconnect(ip: string, clientId: string): void {
    const start = this.sessionStarts.get(clientId);
    this.log('disconnect', {
      ip,
      clientId,
      durationMs: start ? Date.now() - start : undefined,
    });
    this.sessionStarts.delete(clientId);
  }

  authOk(ip: string, clientId: string, sessionId: string): void {
    this.sessionStarts.set(clientId, Date.now());
    this.log('auth_ok', { ip, clientId, sessionId });
  }

  authFail(ip: string, clientId: string, detail?: string): void {
    this.log('auth_fail', { ip, clientId, detail });
  }

  tokenRefresh(ip: string, clientId: string, sessionId: string): void {
    this.log('token_refresh', { ip, clientId, sessionId });
  }

  ipBlocked(ip: string): void {
    this.log('ip_blocked', { ip, detail: 'Not in allowlist' });
  }

  rateLimited(ip: string, detail: string): void {
    this.log('rate_limited', { ip, detail });
  }

  clipboardIn(clientId: string, format: string): void {
    this.log('clipboard_in', { clientId, detail: format });
  }

  clipboardOut(clientId: string, format: string): void {
    this.log('clipboard_out', { clientId, detail: format });
  }

  sessionStart(ip: string, clientId: string, sessionId: string): void {
    this.log('session_start', { ip, clientId, sessionId });
  }

  sessionEnd(ip: string, clientId: string, sessionId: string, durationMs?: number): void {
    this.log('session_end', { ip, clientId, sessionId, durationMs });
  }
}
