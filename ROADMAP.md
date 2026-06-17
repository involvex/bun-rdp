# bun-rdp - Roadmap

## Phase 1 - Foundation (done)
- [x] Monorepo scaffold
- [x] Core binary protocol (FRAME, INPUT, CURSOR, CLIPBOARD, PING, AUTH)
- [x] DXGI capture (D3D11 staging texture, row-pitch copy)
- [x] GDI32 fallback (BitBlt + DrawIconEx cursor compositing)
- [x] Bun-native WebSocket transport
- [x] user32.SendInput (mouse, keyboard, wheel)
- [x] HMAC token auth
- [x] WTSAPI32 real FFI bindings
- [x] Canvas 2D + WebGPU renderer skeleton
- [x] GitHub Actions CI

## Phase 2 - Streaming (done)
- [x] H.264 encoder — full MF pipeline
  - [x] BGRA → NV12 conversion (BT.601, CPU-side)
  - [x] IMFSample + IMFSinkWriter pipeline
  - [x] Keyframe signalling (MFSampleExtension_CleanPoint)
  - [x] Configurable bitrate / fps / keyframe interval / hw-accel flag
  - [x] flush() for clean shutdown
- [x] Browser decoder via WebCodecs
  - [x] VideoDecoder (H.264 avc1.42E01E)
  - [x] isWebCodecsSupported() capability check
  - [x] reset() after stream discontinuity
  - [x] Latency mode (realtime / quality)
- [x] WebGPU renderer — fullscreen quad (WGSL shaders)
  - [x] copyExternalImageToTexture (zero-copy VideoFrame upload)
  - [x] Fallback to Canvas 2D
- [x] Cursor overlay field added to FrameMessage (hotX/hotY)
- [x] PING/PONG RTT in server + latency display in web-ui
- [x] Unified renderer selection (WebGPU+WebCodecs > Canvas+WebCodecs > Canvas raw)

## Phase 3 - Quality (next)
- [ ] Dirty-rect optimisation (DXGI GetFrameDirtyRects — skip unchanged regions)
- [ ] Adaptive bitrate (RTT-based, reduce on congestion)
- [ ] Multi-monitor support (EnumOutputs loop + UI picker)
- [ ] Clipboard sync (bidirectional text + PNG)
- [ ] File transfer channel (chunked over WebSocket)
- [ ] Audio: WASAPI loopback → Opus → WebAudio AudioWorklet
- [ ] Cursor shape message (CURSOR PDU with BGRA bitmap + hotspot)

## Phase 4 - Security
- [ ] TLS (Bun native TLS config or nginx)
- [ ] Token refresh (sliding expiry)
- [ ] IP allowlist / CIDR filter
- [ ] One-time share links
- [ ] Audit log

## Phase 5 - Packaging
- [ ] bun build --compile → single .exe
- [ ] NSIS installer + Windows service
- [ ] Auto-updater (GitHub Releases)
- [ ] System-tray icon
- [ ] Release workflow (tag → build → attach .exe)

## Backlog
- WebRTC data channel transport
- Multi-viewer broadcast
- Session recording (MP4)
- Wake-on-LAN
- Virtual printer channel
