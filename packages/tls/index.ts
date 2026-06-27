/**
 * TLS configuration for bun-rdp server.
 *
 * Three modes (set via env BUN_RDP_TLS):
 *   "auto"    — generate self-signed cert on first run, persist to disk   (default)
 *   "custom"  — use BUN_RDP_CERT + BUN_RDP_KEY paths
 *   "off"     — plain WebSocket (ws://) — LAN-only / behind TLS proxy
 *
 * Self-signed cert generation via `selfsigned` npm package.
 * For production: point to a Let's Encrypt cert via BUN_RDP_CERT / BUN_RDP_KEY.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type TlsMode = 'auto' | 'custom' | 'off';

export interface TlsConfig {
  cert: string; // PEM
  key: string; // PEM
}

const DATA_DIR = process.env.BUN_RDP_DATA_DIR ?? join(process.cwd(), '.rdp-data');
const CERT_PATH = join(DATA_DIR, 'server.crt');
const KEY_PATH = join(DATA_DIR, 'server.key');

// ─── Self-signed cert generation ──────────────────────────────────────────────

/**
 * Generate a self-signed certificate using the `selfsigned` package.
 * Returns PEM-encoded cert + private key.
 */
async function generateSelfSigned(): Promise<TlsConfig> {
  // selfsigned is a CommonJS module — use require
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const selfsigned = require('selfsigned');

  const attrs = [
    { name: 'commonName', value: 'bun-rdp' },
    { name: 'organizationName', value: 'bun-rdp' },
    { name: 'countryName', value: 'DE' },
  ];

  const pems = await selfsigned.generate(attrs, {
    days: 365,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
    keysize: 2048,
  });

  return {
    cert: pems.cert,
    key: pems.private,
  };
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
