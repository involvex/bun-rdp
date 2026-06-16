import { createHmac, randomBytes } from 'crypto';

const SECRET = process.env.BUN_RDP_SECRET ?? randomBytes(32).toString('hex');

/** Issue a short-lived session token */
export function issueToken(sessionId: string, ttlMs = 3_600_000): string {
  const exp = Date.now() + ttlMs;
  const payload = `${sessionId}:${exp}`;
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

/** Verify a token — returns sessionId or null */
export function verifyToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const [sessionId, expStr, sig] = decoded.split(':');
    if (Date.now() > Number(expStr)) return null; // expired
    const expected = createHmac('sha256', SECRET)
      .update(`${sessionId}:${expStr}`)
      .digest('hex');
    return sig === expected ? sessionId : null;
  } catch {
    return null;
  }
}
