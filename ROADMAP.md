# bun-rdp - Roadmap

## Phase 1 - Foundation ✅
- [x] Monorepo scaffold, core protocol, DXGI/GDI32 capture
- [x] WebSocket transport, SendInput, HMAC auth, WTSAPI32 FFI

## Phase 2 - Streaming ✅
- [x] H.264 full MF pipeline (BGRA→NV12, IMFSinkWriter, keyframes)
- [x] WebCodecs VideoDecoder + WebGPU renderer (WGSL fullscreen quad)
- [x] PING/PONG RTT + latency overlay

## Phase 3 - Quality ✅
- [x] Dirty-rect optimisation (DXGI GetFrameDirtyRects, tile-align, merge)
- [x] Adaptive bitrate (AIMD, p95-RTT sliding window)
- [x] WASAPI loopback → Opus (bun:ffi) + WebCodecs AudioDecoder / AudioWorklet
- [x] Cursor shape capture + browser CSS overlay
- [x] Clipboard sync (server + browser, text/html)
- [x] STATS message + full HUD

## Phase 4 - Security ✅
- [x] TLS — auto self-signed ECDSA P-256 (Bun native) or custom cert
- [x] Session + refresh + one-time tokens (HMAC-SHA256, type-checked)
- [x] IP allowlist — IPv4/IPv6 CIDR parser, runtime add/remove
- [x] Rate limiter — sliding window, auth-fail ban, auto-unban
- [x] Audit log — JSON-lines file, all security events

## Phase 5 - Packaging ✅
- [x] bun build --compile → single Windows .exe (bun-windows-x64)
- [x] web-ui asset embedding (embed-assets.ts → base64 map in binary)
- [x] Auto-updater (GitHub Releases API, semver compare, atomic .exe replace)
- [x] System-tray icon (Shell_NotifyIcon, context menu, balloon, share link)
- [x] NSIS installer (service install, firewall rule, Start Menu, uninstaller)
- [x] Release CI (.github/workflows/release.yml) — tag → build → ZIP → NSIS → checksums → GitHub Release
- [x] biome.json lint + format config
- [x] package.json scripts (build, release, typecheck, lint, format)

## Backlog
- WebRTC data channel transport (P2P LAN path, STUN/TURN)
- Multi-viewer broadcast / view-only mode
- Session recording (MP4 via mp4muxer)
- Wake-on-LAN magic packet
- Virtual printer channel
- Android/iOS viewer (React Native + WebCodecs)
- Prometheus /metrics endpoint
