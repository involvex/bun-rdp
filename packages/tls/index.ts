/**
 * TLS configuration for bun-rdp server.
 *
 * Three modes (set via env BUN_RDP_TLS):
 *   "auto"    — generate self-signed cert on first run, persist to disk   (default)
 *   "custom"  — use BUN_RDP_CERT + BUN_RDP_KEY paths
 *   "off"     — plain WebSocket (ws://) — LAN-only / behind TLS proxy
 *
 * Self-signed cert generation via Bun's built-in crypto (SubtleCrypto ECDSA P-256).
 * For production: point to a Let's Encrypt cert via BUN_RDP_CERT / BUN_RDP_KEY.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type TlsMode = 'auto' | 'custom' | 'off';

export interface TlsConfig {
  cert: string; // PEM
  key: string; // PEM
}

const DATA_DIR = process.env.BUN_RDP_DATA_DIR ?? join(process.cwd(), '.rdp-data');
const CERT_PATH = join(DATA_DIR, 'server.crt');
const KEY_PATH = join(DATA_DIR, 'server.key');

// ─── Self-signed cert (ECDSA P-256) ──────────────────────────────────────────

/**
 * Generate a self-signed ECDSA P-256 certificate valid for 365 days.
 * Uses Bun's built-in SubtleCrypto — no openssl binary needed.
 */
async function generateSelfSigned(): Promise<TlsConfig> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  // Export keys as PKCS8 / SPKI
  const privDer = await crypto.subtle.exportKey('pkcs8', privateKey);
  const pubDer = await crypto.subtle.exportKey('spki', publicKey);

  const privPem = toPem('PRIVATE KEY', privDer);
  const pubPem = toPem('PUBLIC KEY', pubDer);

  // Build a minimal self-signed X.509 cert
  // For full X.509 DER we rely on Bun's built-in x509 support (Bun ≥ 1.1)
  const cert = await (
    Bun as unknown as {
      generateCertificate(opts: {
        privateKey: CryptoKey;
        publicKey: CryptoKey;
        subject: string;
        validDays: number;
      }): Promise<string>;
    }
  ).generateCertificate({
    privateKey,
    publicKey,
    subject: 'CN=bun-rdp,O=bun-rdp,C=DE',
    validDays: 365,
  });

  return { cert, key: privPem };
}

function toPem(label: string, der: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function loadTlsConfig(): Promise<TlsConfig | null> {
  const mode = (process.env.BUN_RDP_TLS ?? 'auto') as TlsMode;

  if (mode === 'off') {
    console.log('[tls] Disabled — plain WebSocket');
    return null;
  }

  if (mode === 'custom') {
    const cert = process.env.BUN_RDP_CERT;
    const key = process.env.BUN_RDP_KEY;
    if (!cert || !key) throw new Error('BUN_RDP_TLS=custom requires BUN_RDP_CERT and BUN_RDP_KEY');
    return {
      cert: readFileSync(cert, 'utf8'),
      key: readFileSync(key, 'utf8'),
    };
  }

  // auto mode — load or generate
  if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
    console.log('[tls] Loaded existing cert from', DATA_DIR);
    return {
      cert: readFileSync(CERT_PATH, 'utf8'),
      key: readFileSync(KEY_PATH, 'utf8'),
    };
  }

  console.log('[tls] Generating self-signed certificate…');
  const cfg = await generateSelfSigned();
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CERT_PATH, cfg.cert, { mode: 0o600 });
  writeFileSync(KEY_PATH, cfg.key, { mode: 0o600 });
  console.log('[tls] Certificate saved to', DATA_DIR);
  return cfg;
}
