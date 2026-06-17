# bun-rdp - Roadmap

## Phase 1 - Foundation (done)
- [x] Monorepo scaffold, core protocol, DXGI/GDI32 capture
- [x] WebSocket transport, SendInput, HMAC auth, WTSAPI32 FFI

## Phase 2 - Streaming (done)
- [x] H.264 full MF pipeline (BGRA→NV12, IMFSinkWriter, keyframes)
- [x] WebCodecs VideoDecoder (avc1.42E01E, realtime mode, reset)
- [x] WebGPU renderer (WGSL fullscreen quad, copyExternalImageToTexture)
- [x] PING/PONG RTT + latency overlay

## Phase 3 - Quality (done)
- [x] Dirty-rect optimisation (DXGI GetFrameDirtyRects + GetFrameMoveRects)
  - [x] Tile alignment (16px), rect merging, full-frame threshold (40%)
  - [x] DirtyRectTracker.cropBGRA() for tile extraction
- [x] Adaptive bitrate (AIMD: STEP_UP=+10%, STEP_DOWN=-25%, p95 RTT window)
- [x] Audio: WASAPI loopback capture → Opus encoding (bun:ffi libopus)
- [x] Audio: WebCodecs AudioDecoder + AudioWorklet playback in browser
- [x] Cursor shape capture (GetIconInfo + GetDIBits, hotspot, BGRA bitmap)
- [x] Cursor overlay in browser (CSS-positioned <img>, BGRA→RGBA conversion)
- [x] Clipboard sync server (GetClipboardSequenceNumber polling, text/html)
- [x] Clipboard sync browser (paste event → server, server → navigator.clipboard)
- [x] STATS protocol message (fps, bitrate, rttMs, dirtyRatio)
- [x] Full HUD (status, RTT, FPS, bitrate)

## Phase 4 - Security (next)
- [ ] TLS (Bun native TLS config or nginx reverse proxy)
- [ ] Session token refresh (sliding expiry)
- [ ] IP allowlist / CIDR filter
- [ ] One-time share links (token expires after first use)
- [ ] Audit log entity (who, when, IP, duration)
- [ ] Rate limiting (max connections per IP)

## Phase 5 - Packaging
- [ ] bun build --compile → single Windows .exe
- [ ] NSIS installer + Windows service install
- [ ] Auto-updater (GitHub Releases API)
- [ ] System-tray icon (start/stop/status)
- [ ] Release CI (tag → build → attach .exe to release)

## Backlog
- WebRTC data channel transport (P2P LAN path)
- Multi-viewer broadcast / view-only mode
- Session recording (MP4 via mp4muxer)
- Wake-on-LAN
- Virtual printer channel
- Android/iOS viewer (React Native + WebCodecs)
