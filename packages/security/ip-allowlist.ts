/**
 * IP Allowlist — CIDR-based connection filter
 *
 * Config via env: BUN_RDP_ALLOW_IPS=192.168.1.0/24,10.0.0.1,::1
 * If the env var is not set → allow all IPs (open mode).
 *
 * Supports:
 *   - Single IPv4:          192.168.1.100
 *   - IPv4 CIDR:            192.168.0.0/16
 *   - Single IPv6:          ::1
 *   - IPv6 CIDR:            fd00::/8
 *   - Wildcard (allow all): *
 */

export interface AllowlistConfig {
  /** Comma-separated list of IPs / CIDRs, or "*" for all */
  rules?: string;
}

interface ParsedRule {
  raw:     string;
  isV6:    boolean;
  network: bigint;
  mask:    bigint;
  bits:    number;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function ipv4ToBigInt(ip: string): bigint {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => p < 0 || p > 255)) throw new Error(`Invalid IPv4: ${ip}`);
  return (BigInt(parts[0]) << 24n) | (BigInt(parts[1]) << 16n) | (BigInt(parts[2]) << 8n) | BigInt(parts[3]);
}

function ipv6ToBigInt(ip: string): bigint {
  // Expand :: shorthand
  let expanded = ip;
  if (expanded.includes('::')) {
    const sides = expanded.split('::');
    const left  = sides[0] ? sides[0].split(':') : [];
    const right = sides[1] ? sides[1].split(':') : [];
    const mid   = Array(8 - left.length - right.length).fill('0');
    expanded    = [...left, ...mid, ...right].join(':');
  }
  return expanded.split(':').reduce((acc, grp) => (acc << 16n) | BigInt(parseInt(grp || '0', 16)), 0n);
}

function parseRule(rule: string): ParsedRule {
  rule = rule.trim();
  const [addr, prefixStr] = rule.split('/');
  const isV6    = addr.includes(':');
  const bits    = prefixStr !== undefined ? Number(prefixStr) : (isV6 ? 128 : 32);
  const maxBits = isV6 ? 128 : 32;
  const network = isV6 ? ipv6ToBigInt(addr) : ipv4ToBigInt(addr);
  const mask    = prefixStr !== undefined
    ? ((1n << BigInt(maxBits)) - 1n) ^ ((1n << BigInt(maxBits - bits)) - 1n)
    : (isV6 ? 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn : 0xFFFFFFFFn);
  return { raw: rule, isV6, network: network & mask, mask, bits };
}

function ipToInt(ip: string): { value: bigint; isV6: boolean } {
  if (ip.startsWith('::ffff:') && ip.includes('.')) {
    // IPv4-mapped IPv6 — extract IPv4 part
    return { value: ipv4ToBigInt(ip.slice(7)), isV6: false };
  }
  if (ip.includes(':')) return { value: ipv6ToBigInt(ip), isV6: true };
  return { value: ipv4ToBigInt(ip), isV6: false };
}

// ─── IPAllowlist ──────────────────────────────────────────────────────────────

export class IPAllowlist {
  private rules:    ParsedRule[] = [];
  private allowAll: boolean      = false;

  constructor(cfg: AllowlistConfig = {}) {
    const raw = cfg.rules ?? process.env.BUN_RDP_ALLOW_IPS ?? '*';
    this._load(raw);
  }

  private _load(raw: string): void {
    const entries = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (entries.length === 0 || entries.includes('*')) {
      this.allowAll = true;
      console.log('[allowlist] Open — all IPs allowed');
      return;
    }
    this.rules = entries.map(e => {
      try { return parseRule(e); }
      catch (err) { console.warn(`[allowlist] Invalid rule "${e}": ${err}`); return null; }
    }).filter(Boolean) as ParsedRule[];
    console.log(`[allowlist] ${this.rules.length} rule(s): ${this.rules.map(r => r.raw).join(', ')}`);
  }

  /** Returns true if the IP is allowed */
  isAllowed(ip: string): boolean {
    if (this.allowAll) return true;
    if (this.rules.length === 0) return false;

    let parsed: { value: bigint; isV6: boolean };
    try { parsed = ipToInt(ip.replace(/^\[/, '').replace(/\]$/, '')); }
    catch { return false; }

    for (const rule of this.rules) {
      if (rule.isV6 !== parsed.isV6) continue;
      if ((parsed.value & rule.mask) === rule.network) return true;
    }
    return false;
  }

  /** Add a rule at runtime */
  addRule(cidr: string): void {
    try {
      this.rules.push(parseRule(cidr));
      this.allowAll = false;
      console.log(`[allowlist] Added: ${cidr}`);
    } catch (e) { console.warn(`[allowlist] Invalid: ${cidr} — ${e}`); }
  }

  /** Remove a rule at runtime */
  removeRule(cidr: string): void {
    this.rules = this.rules.filter(r => r.raw !== cidr.trim());
    console.log(`[allowlist] Removed: ${cidr}`);
  }

  get ruleCount() { return this.allowAll ? Infinity : this.rules.length; }
}
