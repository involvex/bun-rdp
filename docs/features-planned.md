# Planned Features

This document tracks features planned for future releases, with technical notes
for implementors. See [ROADMAP.md](../ROADMAP.md) for the high-level roadmap.

---

## 🔴 High Priority

### WebRTC Data Channel Transport
**Why:** P2P LAN path bypasses the server relay, reducing latency to ~5–15ms.
**How:**
- Add `packages/transport/webrtc.ts`
- Server uses `RTCPeerConnection` via a WASM WebRTC lib (e.g. `libdatachannel`)
- Client uses browser-native `RTCDataChannel`
- Signalling over the existing WebSocket connection
- Fallback to WebSocket if ICE negotiation fails
- Protocol messages unchanged — only the transport layer differs

### Multi-Viewer Mode
**Why:** Multiple people viewing the same desktop (e.g. pair programming, support).
**How:**
- `WsTransport` already broadcasts to all authenticated clients
- Add a `viewOnly` flag in `AUTH` message — view-only clients receive frames but INPUT is ignored
- Add a `maxViewers` config option
- Show viewer count in tray icon tooltip

### Session Recording
**Why:** Compliance, support, screen recordings.
**How:**
- Intercept encoded frames in the server loop
- Feed into `mp4muxer` (pure-JS, no ffmpeg needed) to produce an MP4
- Store in `.rdp-data/recordings/<sessionId>-<timestamp>.mp4`
- Add `BUN_RDP_RECORD=true` env flag
- Add a `RecordingManager` that rotates files by size/duration

---

## 🟡 Medium Priority

### Prometheus Metrics Endpoint
**Why:** Production monitoring (Grafana, alerting).
**How:**
- Add `packages/metrics/index.ts`
- Expose `GET /metrics` on a separate port (default 9002)
- Metrics: `bun_rdp_connected_clients`, `bun_rdp_frames_sent_total`,
  `bun_rdp_bitrate_bps`, `bun_rdp_rtt_ms`, `bun_rdp_dirty_ratio`
- Plain text Prometheus format (no dependencies needed)

### File Transfer
**Why:** Drag-and-drop files between local and remote.
**How:**
- New protocol message: `FILE_CHUNK` (0x09), `FILE_META` (0x0A)
- `packages/filetransfer/index.ts` — chunked transfer with flow control
- Client: `<input type="file">` or drag-and-drop → read as ArrayBuffer → send chunks
- Server: write chunks to temp file → move to Desktop on completion
- Reverse: server reads file → sends chunks → client triggers browser download

### Wake-on-LAN
**Why:** Start a sleeping/hibernating PC remotely.
**How:**
- `packages/wakeonlan/index.ts`
- Build a WoL magic packet (6×`0xFF` + 16× MAC address)
- Send via UDP broadcast to port 9 or 7
- Expose as HTTP endpoint: `POST /wol { mac: "aa:bb:cc:dd:ee:ff" }`
- UI: "Wake PC" button in web-ui

### Clipboard Image Sync
**Why:** Copy-paste screenshots / images between remote and local.
**How:**
- Extend `ClipboardMonitor` to detect `CF_DIB` format
- Convert DIB to PNG via GDI32 + `msimg32` or a pure-TS encoder
- Send as `CLIPBOARD { format: 'image/png', data: '<base64>' }`
- Client: `ClipboardItem` API with `Blob`

### Virtual Printer Channel
**Why:** Print documents from remote desktop to local printer.
**How:**
- Intercept print jobs via a virtual PDF printer (install `Microsoft Print to PDF`)
- Monitor output folder for new PDF files
- Send via `FILE_CHUNK` messages
- Client triggers browser `print()` or downloads the PDF

---

## 🟢 Low Priority / Research

### Android / iOS Viewer App
**Why:** Mobile control of your desktop.
**How:**
- React Native app with `react-native-webcodecs` (or expo-av for fallback)
- Reuse `packages/core-protocol` (transpile to browser-compatible JS)
- Touch input → `INPUT` messages (touch = left mouse button)
- Pinch-to-zoom viewport scaling

### H.265 / AV1 Encoding
**Why:** Better compression at same quality (~50% bandwidth vs H.264).
**How:**
- H.265: MF supports `MFVideoFormat_HEVC` — swap encoder output subtype
- AV1: Windows 11 Media Foundation supports `MFVideoFormat_AV1`
- Browser: check `VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L93.B0' })`
- Add `BUN_RDP_CODEC=h264|h265|av1` env flag with auto-negotiation

### GPU-side Color Conversion (HLSL)
**Why:** `convertBGRAtoNV12()` is the bottleneck at 4K+ resolutions.
**How:**
- Write a D3D11 compute shader (HLSL) that converts BGRA → NV12 on GPU
- Input: DXGI captured texture
- Output: NV12 texture (feed directly to MF encoder without CPU readback)
- Expected speedup: ~5–10× at 4K

### Multi-Monitor Support
**Why:** Control a machine with multiple monitors.
**How:**
- `ScreenCapture.init()` already takes `monitorIndex`
- Add `GET /monitors` HTTP endpoint returning monitor list
- UI: monitor picker dropdown in web-ui
- One WebSocket stream per monitor (or composite into one wide frame)

### STUN/TURN for WebRTC
**Why:** WebRTC P2P fails through symmetric NAT without a relay.
**How:**
- Bundle a lightweight STUN server (`bun-stun`) or use a public STUN server
- For TURN: integrate with `coturn` or a hosted TURN service
- Config: `BUN_RDP_STUN_URL`, `BUN_RDP_TURN_URL`, `BUN_RDP_TURN_SECRET`

### Two-Factor Authentication
**Why:** Extra security layer for exposed servers.
**How:**
- TOTP (RFC 6238) — generate/verify 6-digit codes with `bun:crypto`
- QR code for authenticator app setup (`qrcode` package)
- New auth flow: password → TOTP → session token
- Recovery codes (10×8 random hex, hashed in `.env`)

---

## Implementation Priority Matrix

| Feature | Impact | Effort | Priority |
|---|---|---|---|
| WebRTC transport | High | High | 🔴 Next major |
| Session recording | High | Medium | 🔴 Next major |
| Multi-viewer | Medium | Low | 🔴 Next minor |
| Prometheus metrics | Medium | Low | 🟡 Soon |
| File transfer | High | Medium | 🟡 Soon |
| GPU color conversion | High | High | 🟡 Soon (4K) |
| Wake-on-LAN | Medium | Low | 🟢 Easy win |
| Multi-monitor | Medium | Medium | 🟢 Easy win |
| H.265 / AV1 | High | Low | 🟢 Easy win |
| Clipboard images | Low | Medium | 🟢 Nice to have |
| 2FA | Medium | Medium | 🟢 Nice to have |
| iOS/Android app | High | Very High | 🔵 Long-term |
| Virtual printer | Low | High | 🔵 Long-term |
