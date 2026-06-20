/**
 * Rate limiter — sliding window per IP
 *
 * Protects against brute-force auth attempts and connection floods.
 *
 * Config:
 *   BUN_RDP_RATE_WINDOW_MS   — window duration  (default 60 000 = 1 min)
 *   BUN_RDP_RATE_MAX_CONN    — max connections per window (default 10)
 *   BUN_RDP_RATE_MAX_AUTH    — max failed auth attempts per window (default 5)
 */

interface Bucket {
  connections: number[]; // timestamps of connection attempts
  authFails: number[]; // timestamps of failed auth attempts
  banned: boolean;
  banUntil: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private windowMs: number;
  private maxConn: number;
  private maxAuth: number;
  private banMs: number;

  constructor() {
    this.windowMs = Number(process.env.BUN_RDP_RATE_WINDOW_MS ?? 60_000);
    this.maxConn = Number(process.env.BUN_RDP_RATE_MAX_CONN ?? 10);
    this.maxAuth = Number(process.env.BUN_RDP_RATE_MAX_AUTH ?? 5);
    this.banMs = Number(process.env.BUN_RDP_RATE_BAN_MS ?? 300_000); // 5 min ban
    // Prune stale buckets every minute
    setInterval(() => this._prune(), 60_000);
  }

  private _bucket(ip: string): Bucket {
    if (!this.buckets.has(ip)) {
      this.buckets.set(ip, { connections: [], authFails: [], banned: false, banUntil: 0 });
    }
    return this.buckets.get(ip)!;
  }

  private _prune(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [ip, b] of this.buckets) {
      b.connections = b.connections.filter((t) => t > cutoff);
      b.authFails = b.authFails.filter((t) => t > cutoff);
      if (!b.banned && b.connections.length === 0 && b.authFails.length === 0) {
        this.buckets.delete(ip);
      }
    }
  }

  /** Check + record a new connection attempt. Returns false if denied. */
  checkConnection(ip: string): boolean {
    const b = this._bucket(ip);
    const now = Date.now();

    if (b.banned && now < b.banUntil) return false;
    if (b.banned) {
      b.banned = false;
    } // ban expired

    const cutoff = now - this.windowMs;
    b.connections = b.connections.filter((t) => t > cutoff);

    if (b.connections.length >= this.maxConn) {
      console.warn(
        `[ratelimit] Connection flood from ${ip} (${b.connections.length}/${this.maxConn})`
      );
      b.banned = true;
      b.banUntil = now + this.banMs;
      return false;
    }

    b.connections.push(now);
    return true;
  }

  /** Record a failed auth attempt. Returns false (and bans) if threshold exceeded. */
  recordAuthFail(ip: string): boolean {
    const b = this._bucket(ip);
    const now = Date.now();
    const cutoff = now - this.windowMs;

    b.authFails = b.authFails.filter((t) => t > cutoff);
    b.authFails.push(now);

    if (b.authFails.length >= this.maxAuth) {
      console.warn(`[ratelimit] Auth flood from ${ip} (${b.authFails.length} fails) — banned`);
      b.banned = true;
      b.banUntil = now + this.banMs;
      return false;
    }
    return true;
  }

  /** Manually unban an IP */
  unban(ip: string): void {
    const b = this.buckets.get(ip);
    if (b) {
      b.banned = false;
      b.banUntil = 0;
    }
  }

  stats(): Array<{ ip: string; connections: number; authFails: number; banned: boolean }> {
    return [...this.buckets.entries()].map(([ip, b]) => ({
      ip,
      connections: b.connections.length,
      authFails: b.authFails.length,
      banned: b.banned,
    }));
  }
}
