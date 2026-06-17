# Security

## Threat Model

bun-rdp gives full control of a Windows desktop to anyone with a valid token.
The security model assumes:
- The server runs on a trusted network (LAN) or behind a firewall
- TLS protects traffic in transit
- Tokens protect against unauthorized access

**Not in scope:** Protection against a compromised OS, kernel-level attacks,
or side-channel attacks on the host.

---

## Layers

### 1. Transport Security (TLS)

Three modes via `BUN_RDP_TLS`:

| Mode | Description | Use case |
|---|---|---|
| `auto` | Self-signed ECDSA P-256, auto-generated on first run, cached in `.rdp-data/` | Dev / LAN |
| `custom` | Your own cert (`BUN_RDP_CERT` + `BUN_RDP_KEY`) | Production / Let's Encrypt |
| `off` | Plain `ws://` | Behind TLS-terminating reverse proxy |

**Self-signed cert limitations:**
- Browsers will show a security warning
- Chrome: navigate to `chrome://flags/#allow-insecure-localhost` or add cert to OS trust store
- For production: use Let's Encrypt via `certbot` and set `BUN_RDP_TLS=custom`

---

### 2. IP Allowlist

```env
BUN_RDP_ALLOW_IPS=192.168.1.0/24,10.0.0.1,::1
```

Supports full IPv4 and IPv6 CIDR notation.
Connections from non-allowlisted IPs receive `403 Forbidden` before the WebSocket upgrade.
Default: `*` (allow all) — **change this in production**.

---

### 3. Rate Limiter

Sliding window per IP address:

| Setting | Default | Description |
|---|---|---|
| `BUN_RDP_RATE_WINDOW_MS` | `60000` | Window duration (1 min) |
| `BUN_RDP_RATE_MAX_CONN` | `10` | Max WebSocket connections per window |
| `BUN_RDP_RATE_MAX_AUTH` | `5` | Max failed auth attempts per window |
| `BUN_RDP_RATE_BAN_MS` | `300000` | Ban duration after threshold (5 min) |

Responses:
- Connection flood → `429 Too Many Requests`
- Auth-fail flood → connection closed, IP banned for `BAN_MS`

---

### 4. Token Authentication

All tokens are HMAC-SHA256 signed with `BUN_RDP_SECRET`.

**⚠️ Always set `BUN_RDP_SECRET` in production.** Without it, an ephemeral secret
is generated per process restart — all existing tokens are invalidated on restart.

```bash
# Generate a strong secret:
openssl rand -hex 32
# Or with Bun:
bun run server/index.ts --gen-secret
```

#### Token types

| Type | TTL | Use case |
|---|---|---|
| `session` | 1h | Standard connection token |
| `refresh` | 24h | Used to obtain new session tokens without re-auth |
| `onetime` | 1h | Single-use share link (`BUN_RDP_PRINT_TOKEN=1`) |

One-time tokens are invalidated in-memory on first use. They auto-expire if unused.

#### Token format (base64url-decoded)
```
type:sessionId:expiry_ms:hmac_hex
```

---

### 5. Audit Log

All security events are logged to `.rdp-data/audit.log` (JSON-lines format):

```json
{"id":"uuid","ts":"2026-06-17T09:57:00.000Z","type":"auth_ok","ip":"192.168.1.5","clientId":"abc123","sessionId":"def456"}
{"id":"uuid","ts":"2026-06-17T09:58:00.000Z","type":"clipboard_in","clientId":"abc123","detail":"text"}
{"id":"uuid","ts":"2026-06-17T09:59:00.000Z","type":"disconnect","ip":"192.168.1.5","clientId":"abc123","durationMs":3600000}
```

**Event types:**
`connect`, `disconnect`, `auth_ok`, `auth_fail`, `token_refresh`,
`ip_blocked`, `rate_limited`, `clipboard_in`, `clipboard_out`,
`session_start`, `session_end`

---

## Hardening Checklist (Production)

- [ ] Set `BUN_RDP_SECRET` to a random 64-char hex string
- [ ] Set `BUN_RDP_TLS=custom` with a valid Let's Encrypt certificate
- [ ] Set `BUN_RDP_ALLOW_IPS` to your network range
- [ ] Set `BUN_RDP_HEADLESS=true` if running as a Windows Service
- [ ] Set `BUN_RDP_AUTO_UPDATE=false` if you manage updates manually
- [ ] Restrict Windows Firewall rule to specific source IPs
- [ ] Run the service under a dedicated low-privilege Windows account
- [ ] Monitor `.rdp-data/audit.log` for suspicious patterns
- [ ] Rotate `BUN_RDP_SECRET` periodically (invalidates all active sessions)
