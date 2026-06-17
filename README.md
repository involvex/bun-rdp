<div align="center">

# 🖥️ bun-rdp

**A custom Remote Desktop system built entirely with [Bun](https://bun.sh) + [bun-win32](https://github.com/nicolo-ribaudo/bun-win32)**

[![CI](https://github.com/involvex/bun-rdp/actions/workflows/ci.yml/badge.svg)](https://github.com/involvex/bun-rdp/actions/workflows/ci.yml)
[![Release](https://github.com/involvex/bun-rdp/actions/workflows/release.yml/badge.svg)](https://github.com/involvex/bun-rdp/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-blue?logo=windows)](https://www.microsoft.com/windows)

*Not RDP — your own protocol, your own stack.*

</div>

---

## ✨ Features

| Feature | Details |
|---|---|
| **Screen Capture** | DXGI Desktop Duplication (GPU) with GDI32 BitBlt fallback |
| **Video Encoding** | H.264 via Windows Media Foundation (hardware accelerated) |
| **Video Decoding** | WebCodecs `VideoDecoder` in the browser |
| **Rendering** | WebGPU fullscreen quad (Canvas 2D fallback) |
| **Transport** | Bun-native WebSocket — sub-millisecond overhead |
| **Audio** | WASAPI loopback capture → Opus → WebAudio `AudioWorklet` |
| **Input** | `user32.SendInput` — mouse, keyboard, scroll |
| **Cursor** | Live cursor shape sync (bitmap + hotspot) |
| **Clipboard** | Bidirectional sync (text, HTML) |
| **TLS** | Auto self-signed ECDSA P-256 or custom cert |
| **Auth** | HMAC-SHA256 tokens — session, refresh, one-time share links |
| **Security** | IP allowlist (CIDR), rate limiter, audit log |
| **Dirty Rects** | DXGI `GetFrameDirtyRects` — ~70–85% bandwidth saving on idle |
| **Adaptive Bitrate** | AIMD controller, p95-RTT based |
| **Packaging** | `bun build --compile` → single `.exe`, NSIS installer |
| **Auto-update** | GitHub Releases API, atomic binary replace |
| **System Tray** | `Shell_NotifyIcon` with context menu + balloon notifications |
| **Session API** | WTSAPI32 — enumerate, query, disconnect, logoff sessions |

---

## 🏗️ Architecture

```
┌─────────────────────────── SERVER (Windows) ────────────────────────────┐
│                                                                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐   │
│  │ DXGI Capture │───▶│ NV12 Convert │───▶│  H.264 Encoder (MF/HW)  │   │
│  │ GDI32 Fallbk │    │  (BT.601)    │    │  Keyframe + Dirty Rects  │   │
│  └──────────────┘    └──────────────┘    └────────────┬─────────────┘   │
│                                                        │                 │
│  ┌──────────────┐    ┌──────────────┐                 │                 │
│  │WASAPI Loopbk │───▶│ Opus Encoder │                 │                 │
│  │  48kHz/2ch   │    │  (bun:ffi)   │                 │                 │
│  └──────────────┘    └──────┬───────┘                 │                 │
│                             │                          │                 │
│  ┌──────────────────────────▼──────────────────────────▼──────────────┐ │
│  │              Bun WebSocket Transport (TLS optional)                 │ │
│  │         IP Allowlist · Rate Limiter · Audit Log · Auth              │ │
│  └──────────────────────────────────────┬────────────────────────────┘  │
└─────────────────────────────────────────│───────────────────────────────┘
                                          │  wss://
┌─────────────────────────── CLIENT (Browser) ────────────────────────────┐
│                                         │                                │
│  ┌──────────────────────────────────────▼────────────────────────────┐  │
│  │                    WebSocket (binary, Annex-B)                     │  │
│  └──────┬──────────────────────────────────────────────┬─────────────┘  │
│         │ H.264 frames                                  │ Opus packets   │
│  ┌──────▼──────┐    ┌──────────────┐    ┌──────────────▼─────────────┐  │
│  │  WebCodecs  │    │    WebGPU    │    │    AudioDecoder (Opus)      │  │
│  │VideoDecoder │───▶│  Renderer   │    │  + AudioWorklet playback    │  │
│  └─────────────┘    └──────────────┘    └────────────────────────────┘  │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  Input Capture (mouse · keyboard · wheel) → SendInput messages    │   │
│  │  Cursor overlay · Clipboard sync · RTT/FPS/Bitrate HUD            │   │
│  └───────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
bun-rdp/
├── packages/
│   ├── core-protocol/      # Binary message types (FRAME, INPUT, AUDIO, …)
│   ├── screen-capture/     # DXGI Desktop Duplication + GDI32 fallback
│   │   └── dirty-rect.ts   # Dirty-rect optimisation
│   ├── encoder/            # H.264 Media Foundation pipeline
│   ├── audio/              # WASAPI loopback capture + browser Opus player
│   ├── input/              # user32.SendInput wrappers
│   ├── transport/          # Bun WebSocket server (TLS, IP filter, rate limit)
│   ├── auth/               # HMAC tokens — session / refresh / one-time
│   ├── tls/                # TLS config — auto self-signed or custom cert
│   ├── security/           # IP allowlist (CIDR) + rate limiter
│   ├── audit/              # Audit log (JSON-lines)
│   ├── clipboard/          # Win32 clipboard monitor + setter
│   ├── cursor/             # Cursor shape capture
│   ├── adaptive-bitrate/   # AIMD ABR controller
│   ├── wts/                # WTSAPI32 FFI bindings
│   └── utils/              # Logger, helpers
├── server/
│   ├── index.ts            # Main server entry — wires everything together
│   ├── session-manager.ts  # Session lifecycle
│   └── protocol-handler.ts # Message routing
├── client/
│   ├── index.ts            # Headless Bun client
│   ├── input-capture.ts    # DOM input → protocol messages
│   └── renderer/
│       ├── canvas.ts       # Canvas 2D renderer (fallback)
│       ├── webgpu.ts       # WebGPU renderer (preferred)
│       └── webcodecs.ts    # WebCodecs H.264 decoder
├── web-ui/                 # Vite browser client
│   ├── src/main.ts         # Full client — video + audio + cursor + clipboard
│   └── public/index.html   # HUD: status, RTT, FPS, bitrate
├── scripts/
│   ├── build.ts            # Production build (Vite + bun --compile + ZIP)
│   ├── embed-assets.ts     # Embed web-ui into server binary
│   ├── updater.ts          # Auto-updater (GitHub Releases)
│   └── tray.ts             # System-tray icon (Shell_NotifyIcon)
├── installer/
│   └── bun-rdp.nsi         # NSIS installer script
├── docs/                   # Documentation
│   ├── architecture.md
│   ├── protocol.md
│   ├── security.md
│   ├── api.md
│   └── development.md
├── .github/
│   └── workflows/
│       ├── ci.yml          # Type-check + lint on every push
│       └── release.yml     # Tag → build → NSIS → GitHub Release
├── biome.json              # Lint + format config
├── bunfig.toml
├── package.json
├── tsconfig.json
├── .env.example
├── ROADMAP.md
└── AGENTS.md               # AI agent contribution guide
```

---

## 🚀 Quick Start

### Requirements

- **Windows 10 / 11** (DXGI requires Windows 8+)
- **[Bun](https://bun.sh) ≥ 1.1** — `powershell -c "irm bun.sh/install.ps1 | iex"`
- **[bun-win32](https://github.com/nicolo-ribaudo/bun-win32)** — installed via `bun install`
- **opus.dll** in `PATH` or server directory (for audio)

### Install

```bash
git clone https://github.com/involvex/bun-rdp
cd bun-rdp
bun install
cp .env.example .env
# Edit .env — set BUN_RDP_SECRET to a random 64-char hex string
```

### Run (development)

```bash
# Server (with share-link printed to console)
bun run server:prod

# Browser client — open the printed URL in Chrome/Edge
# Or start the Vite dev server:
bun run web-ui
```

### Build (production)

```bash
bun run build
# → dist/bun-rdp-server.exe   (standalone binary, ~15 MB)
# → dist/web-ui/              (static browser client)
# → dist/bun-rdp-1.0.0-win-x64.zip

# Build NSIS installer (requires NSIS)
bun run installer
# → dist/bun-rdp-1.0.0-setup.exe
```

---

## ⚙️ Configuration

All settings via environment variables (`.env` file or system env).

| Variable | Default | Description |
|---|---|---|
| `PORT` | `9001` | WebSocket port |
| `FPS` | `30` | Target capture FPS |
| `BITRATE` | `2000000` | Initial H.264 bitrate (bits/s) |
| `AUDIO` | `true` | Enable WASAPI loopback audio |
| `BUN_RDP_TLS` | `auto` | `auto` / `custom` / `off` |
| `BUN_RDP_CERT` | — | Path to PEM cert (TLS=custom) |
| `BUN_RDP_KEY` | — | Path to PEM key (TLS=custom) |
| `BUN_RDP_SECRET` | *ephemeral* | HMAC signing secret (set in production!) |
| `BUN_RDP_ALLOW_IPS` | `*` | Comma-separated IPs/CIDRs |
| `BUN_RDP_RATE_MAX_AUTH` | `5` | Max failed auth per window |
| `BUN_RDP_RATE_BAN_MS` | `300000` | Ban duration (ms) |
| `BUN_RDP_AUTO_UPDATE` | `true` | Check GitHub Releases on startup |
| `BUN_RDP_PRINT_TOKEN` | — | Print one-time share link on startup |
| `BUN_RDP_HEADLESS` | `false` | No tray icon (service mode) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

See [`.env.example`](.env.example) for all options.

---

## 🔐 Security

See [`docs/security.md`](docs/security.md) for full details.

**Quick summary:**
- All connections over **TLS** (auto self-signed or Let's Encrypt cert)
- **HMAC-SHA256** signed tokens — session (1h), refresh (24h), one-time share links
- **IP allowlist** with full IPv4/IPv6 CIDR support
- **Rate limiter** — sliding window, auth-fail ban, auto-expire
- **Audit log** — every connect, auth, clipboard event logged to JSON-lines

---

## 🔌 Protocol

See [`docs/protocol.md`](docs/protocol.md) for the full binary protocol spec.

**Message types:**

| ID | Name | Direction | Description |
|---|---|---|---|
| `0x01` | `FRAME` | S→C | H.264 Annex-B video frame |
| `0x02` | `INPUT` | C→S | Mouse / keyboard / wheel event |
| `0x03` | `CURSOR` | S→C | Cursor shape + hotspot |
| `0x04` | `CLIPBOARD` | Both | Clipboard sync (text, HTML) |
| `0x05` | `PING` | Both | RTT keepalive |
| `0x06` | `AUTH` | Both | Authentication handshake |
| `0x07` | `AUDIO` | S→C | Opus audio packet |
| `0x08` | `STATS` | S→C | FPS / bitrate / RTT stats |

---

## 📜 License

[MIT](LICENSE) © 2026 involvex
