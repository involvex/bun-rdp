# Architecture

## Overview

bun-rdp is a monorepo with a clear separation between:
- **Server** — Windows-only, runs on the machine being controlled
- **Client** — browser-based, runs on the controlling machine

Communication is over a binary WebSocket protocol (TLS optional).

## Server Pipeline

```
DXGI AcquireNextFrame
        │
        ├── GetFrameDirtyRects ──▶ DirtyRectTracker.query()
        │                                 │
        │                    fullFrame? ──┤
        │                                 │
        └── BGRA pixel buffer ────────────▼
                                  convertBGRAtoNV12()
                                          │
                                  IMFSample (NV12)
                                          │
                                  H264Encoder.encodeFrame()
                                          │
                                  Annex-B Uint8Array
                                          │
                                  WsTransport.broadcast(FRAME)
```

### Capture backends

| Backend | API | When |
|---|---|---|
| Primary | `IDXGIOutputDuplication` (DXGI 1.2) | Windows 8+, GPU available |
| Fallback | `BitBlt` (GDI32) | VM, RDP-in-RDP, no GPU |

DXGI provides:
- GPU-side zero-copy capture (no readback until `Map()`)
- Dirty rectangles via `GetFrameDirtyRects`
- Move rectangles via `GetFrameMoveRects` (scroll, drag optimisation)

### Dirty-rect flow

1. After `AcquireNextFrame`, call `DirtyRectTracker.query()`
2. Align dirty rects to 16px tile boundary (DCT-friendly)
3. Merge overlapping rects (O(n²) sweep — fine for typical rect counts < 20)
4. If merged area ≥ 40% of screen → encode full frame
5. Else → encode only dirty tiles, send `rects[]` in the FRAME message
6. Client uses `rects[]` to only update dirty regions on canvas

### H.264 encoder

Uses Windows Media Foundation `IMFSinkWriter`:
1. `MFCreateSinkWriterFromMediaSink` with MPEG-4 byte stream
2. Input type: `MFVideoFormat_NV12`
3. Output type: `MFVideoFormat_H264`, hardware transforms enabled
4. `WriteSample()` per frame → `GetOutputSample()` pulls encoded NAL units
5. `MFSampleExtension_CleanPoint` marks keyframes (every `keyframeInterval` frames)

### Audio pipeline

```
IAudioCaptureClient (WASAPI loopback, 48kHz float32 stereo)
        │  960 samples = 20ms Opus frame
        ▼
opus_encode_float() [bun:ffi → libopus.dll]
        │
        ▼
Uint8Array (Opus packet, ~100–400 bytes per frame)
        │
        ▼
WsTransport.broadcast(AUDIO)
```

## Client Pipeline

```
WebSocket message (ArrayBuffer)
        │
        ├── FRAME → VideoDecoder.decode(EncodedVideoChunk)
        │                │
        │                ▼
        │           VideoFrame (GPU texture)
        │                │
        │         ┌──────┴──────┐
        │         │ WebGPU      │ Canvas 2D
        │         │ (preferred) │ (fallback)
        │         └─────────────┘
        │
        ├── AUDIO → AudioDecoder.decode(EncodedAudioChunk)
        │                │
        │                ▼
        │           AudioData (PCM float32)
        │                │
        │           AudioWorklet (opus-player processor)
        │                │
        │           AudioContext.destination (speakers)
        │
        ├── CURSOR → CSS-positioned <img> overlay (BGRA → RGBA → Blob URL)
        │
        └── CLIPBOARD → navigator.clipboard.writeText()
```

### Renderer selection (auto)

```
isWebCodecsSupported()?
  YES → WebGPU available?
            YES → WebGPU + WebCodecs  (best — GPU zero-copy)
            NO  → Canvas2D + WebCodecs
  NO  → Canvas2D raw (no H.264 decode — fallback to BGRA stream)
```

## Transport

```
Bun.serve() ──▶ fetch handler
                    │
                    ├── IPAllowlist.isAllowed(ip)?  NO → 403
                    ├── RateLimiter.checkConnection(ip)?  NO → 429
                    └── server.upgrade(req) ──▶ WebSocket
                                                    │
                                                    ├── open  → AuditLogger.connect()
                                                    ├── message → route by MessageType
                                                    └── close → AuditLogger.disconnect()
```

Wire format: `[4-byte big-endian length][JSON body]`

## Security layers

```
Network
  └── TLS (wss://) ── auto ECDSA P-256 self-signed or custom cert
        └── IP Allowlist (CIDR, IPv4 + IPv6)
              └── Rate Limiter (sliding window, auth-fail ban)
                    └── Token Auth (HMAC-SHA256, session/refresh/onetime)
                          └── Audit Log (JSON-lines)
```

## Package dependency graph

```
core-protocol   (no deps)
     ▲
     ├── transport ◀── security/{ip-allowlist, rate-limiter}
     │                        ▲
     │                        └── audit
     ├── encoder
     ├── screen-capture
     │      └── dirty-rect
     ├── audio
     ├── input
     ├── cursor
     ├── clipboard
     ├── auth
     ├── tls
     ├── wts
     └── utils
          ▲
          └── (all packages import utils)
```
