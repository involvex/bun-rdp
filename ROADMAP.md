# bun-rdp - Roadmap

## Phase 1 - Foundation (done)
- [x] Monorepo scaffold, core protocol, DXGI/GDI32 capture
- [x] WebSocket transport, SendInput, HMAC auth, WTSAPI32 FFI

## Phase 2 - Streaming (done)
- [x] H.264 full MF pipeline (BGRA→NV12, IMFSinkWriter, keyframes)
- [x] WebCodecs VideoDecoder + WebGPU renderer (fullscreen quad, WGSL)
- [x] PING/PONG RTT + latency overlay

## Phase 3 - Quality (done)
- [x] Dirty-rect optimisation (DXGI GetFrameDirtyRects, tile-align, merge)
- [x] Adaptive bitrate (AIMD p95-RTT, +10%/-25%)
- [x] Audio: WASAPI loopback → Opus (bun:ffi) + WebCodecs AudioDecoder / AudioWorklet
- [x] Cursor shape capture + browser overlay
- [x] Clipboard sync (server + browser, text/html)
- [x] STATS protocol message + full HUD

## Phase 4 - Security (done)
- [x] TLS — Bun native (auto self-signed ECDSA P-256 or custom cert/key)
- [x] Session tokens — HMAC-SHA256, configurable TTL, type-checked (session/refresh/onetime)
- [x] Refresh tokens — issue new session+refresh pair without re-auth
- [x] One-time share links — single-use tokens with in-memory invalidation
- [x] IP allowlist — CIDR parser (IPv4 + IPv6), runtime add/remove
- [x] Rate limiter — sliding window per-IP, auth-fail tracking, auto-ban + manual unban
- [x] Audit log — FileAuditWriter (JSON-lines), all security events logged
- [x] Transport — X-Forwarded-For IP extraction, 403/429 responses

## Phase 5 - Packaging (next)
- [ ] bun build --compile → single Windows .exe (server + embedded web-ui)
- [ ] NSIS installer with Windows service install option
- [ ] Auto-updater (GitHub Releases API check on startup)
- [ ] System-tray icon (Rust/C++ shim or bun-win32 Shell_NotifyIcon)
- [ ] Release CI workflow (tag → build → sign → attach .exe to GitHub Release)
- [ ] biome.json (lint config) + pre-commit hooks

## Backlog
- WebRTC data channel transport (P2P LAN path, STUN/TURN)
- Multi-viewer broadcast / view-only mode
- Session recording (MP4 via mp4muxer)
- Wake-on-LAN magic packet
- Virtual printer channel
- Android/iOS viewer (React Native + WebCodecs)
- Prometheus metrics endpoint (/metrics)
