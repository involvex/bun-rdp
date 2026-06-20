/**
 * Auth — HMAC-SHA256 session tokens with refresh + one-time share tokens
 *
 * Token format (base64url-encoded):  sessionId:exp:sig
 *
 * Token types:
 *   session     — renewable; valid for TTL_SESSION_MS (default 1 h)
 *   refresh     — long-lived; used to obtain new session tokens
 *   one-time    — single-use share links; invalidated on first use
 */
import { createHmac, randomBytes } from 'crypto';

// ─── Secret ───────────────────────────────────────────────────────────────────

const SECRET =
  process.env.BUN_RDP_SECRET ??
  (() => {
    const s = randomBytes(32).toString('hex');
    console.warn(
      '[auth] BUN_RDP_SECRET not set — using ephemeral secret (tokens invalidated on restart)'
    );
    return s;
  })();

// ─── TTL ──────────────────────────────────────────────────────────────────────

const TTL_SESSION_MS = Number(process.env.BUN_RDP_SESSION_TTL_MS ?? 3_600_000); // 1 h
const TTL_REFRESH_MS = Number(process.env.BUN_RDP_REFRESH_TTL_MS ?? 86_400_000); // 24 h
const TTL_ONETIME_MS = Number(process.env.BUN_RDP_ONETIME_TTL_MS ?? 3_600_000); // 1 h

// ─── One-time token store (in-memory; replace with DB entity for multi-process)
const usedTokens = new Set<string>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

function makeToken(sessionId: string, type: string, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  const payload = `${type}:${sessionId}:${exp}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function parseToken(
  token: string
): { type: string; sessionId: string; exp: number; sig: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');
    if (parts.length < 4) return null;
    const [type, sessionId, expStr, ...sigParts] = parts;
    return { type, sessionId, exp: Number(expStr), sig: sigParts.join(':') };
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Issue a session token (short-lived, renewable) */
export function issueToken(sessionId: string): string {
  return makeToken(sessionId, 'session', TTL_SESSION_MS);
}

/** Issue a refresh token (long-lived) */
export function issueRefreshToken(sessionId: string): string {
  return makeToken(sessionId, 'refresh', TTL_REFRESH_MS);
}

/** Issue a one-time share link token */
export function issueOneTimeToken(sessionId: string): string {
  return makeToken(sessionId, 'onetime', TTL_ONETIME_MS);
}

export interface VerifyResult {
  sessionId: string;
  type: 'session' | 'refresh' | 'onetime';
  expiresAt: number;
}

/**
 * Verify any token type.
 * Returns VerifyResult or null on invalid / expired / already-used.
 */
export function verifyToken(token: string): VerifyResult | null {
  const parsed = parseToken(token);
  if (!parsed) return null;

  const { type, sessionId, exp, sig } = parsed;

  // Check expiry
  if (Date.now() > exp) return null;

  // Verify HMAC
  const expected = sign(`${type}:${sessionId}:${exp}`);
  if (sig !== expected) return null;

  // One-time: reject if already used
  if (type === 'onetime') {
    if (usedTokens.has(token)) return null;
    usedTokens.add(token);
    // Auto-cleanup after TTL
    setTimeout(() => usedTokens.delete(token), TTL_ONETIME_MS);
  }

  return { sessionId, type: type as VerifyResult['type'], expiresAt: exp };
}

/**
 * Refresh a session token using a valid refresh token.
 * Returns a new { sessionToken, refreshToken } pair or null.
 */
export function refreshSession(
  refreshToken: string
): { sessionToken: string; refreshToken: string } | null {
  const result = verifyToken(refreshToken);
  if (!result || result.type !== 'refresh') return null;
  return {
    sessionToken: issueToken(result.sessionId),
    refreshToken: issueRefreshToken(result.sessionId),
  };
}

/** Generate a new session ID */
export function newSessionId(): string {
  return randomBytes(16).toString('hex');
}
