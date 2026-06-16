# bun-rdp - Roadmap

## Phase 1 - Foundation (done)
- [x] Monorepo scaffold
- [x] Core binary protocol (FRAME, INPUT, CURSOR, CLIPBOARD, PING, AUTH)
- [x] DXGI capture (D3D11 staging texture, row-pitch copy)
- [x] GDI32 fallback (BitBlt + DrawIconEx cursor compositing)
- [x] H.264 encoder skeleton (Media Foundation)
- [x] Bun-native WebSocket transport
- [x] user32.SendInput (mouse, keyboard, wheel)
- [x] HMAC token auth
- [x] WTSAPI32 real FFI: enumerateSessions, queryString, isRemoteSession, getClientDisplay, sendMessage, disconnect, logoff
- [x] Canvas 2D + WebGPU renderer skeleton
- [x] GitHub Actions CI

## Phase 2 - Streaming (next)
- [ ] H.264 full MF pipeline (NV12 input, Annex-B output)
- [ ] Browser decoder via WebCodecs (VideoDecoder + EncodedVideoChunk)
- [ ] Cursor overlay (CURSOR message + canvas composite)
- [ ] Dirty-rect optimisation (DXGI GetFrameDirtyRects)
- [ ] Audio: WASAPI loopback -> Opus -> WebAudio

## Phase 3 - Quality
- [ ] Adaptive bitrate
- [ ] Multi-monitor support
- [ ] Clipboard sync (text + images)
- [ ] File transfer channel
- [ ] Latency overlay (PING round-trip)

## Phase 4 - Security
- [ ] TLS (Bun native or nginx)
- [ ] Token refresh
- [ ] IP allowlist
- [ ] One-time share links
- [ ] Audit log

## Phase 5 - Packaging
- [ ] `bun build --compile` -> single .exe
- [ ] NSIS installer + Windows service
- [ ] Auto-updater (GitHub Releases)
- [ ] System-tray icon
- [ ] Release workflow (tag -> build -> attach .exe)

## Backlog
- WebRTC data channel transport
- Multi-viewer broadcast mode
- Session recording (MP4 via mp4muxer)
- Wake-on-LAN
- Virtual printer channel
