# Wire Protocol

## Framing

Every message is length-prefixed:

```
┌──────────────────────────────────────────────────────┐
│  4 bytes (uint32 BE)  │  N bytes (UTF-8 JSON body)   │
│  body length          │  RdpMessage                  │
└──────────────────────────────────────────────────────┘
```

- Length field: big-endian `uint32`, value = byte length of the JSON body
- Body: UTF-8 encoded JSON
- Binary blobs (video frames, audio packets, cursor bitmaps): base64-encoded inside JSON

> **Note:** Future versions may switch the body to MessagePack or a custom binary
> format for lower overhead. The framing envelope will remain the same.

## Message Types

### `FRAME` (0x01) — Server → Client

Carries one encoded H.264 Annex-B video frame.

```typescript
{
  type:      1,
  timestamp: 1718613600000,   // Date.now() on server
  width:     1920,
  height:    1080,
  keyframe:  true,            // IDR frame — client must reset decoder if false after reconnect
  rects?:    [               // dirty rects — absent = full frame
    { x: 0, y: 0, w: 1920, h: 1080 }
  ],
  data:      "AAAAAAAA…"     // base64 Annex-B NAL units
}
```

**Client behaviour:**
- On first `FRAME` (or after reconnect): wait for `keyframe: true` before decoding
- If `rects` present: only composite dirty regions onto the display canvas
- Pass `data` to `VideoDecoder.decode(new EncodedVideoChunk({ type: keyframe ? 'key' : 'delta', … }))`

---

### `INPUT` (0x02) — Client → Server

Mouse, keyboard, or scroll wheel event.

```typescript
// Mouse move
{ type: 2, inputType: 'mouse', x: 960, y: 540 }

// Mouse button
{ type: 2, inputType: 'mouse', button: 0, flags: 1 }  // flags: 1=down, 0=up

// Keyboard
{ type: 2, inputType: 'keyboard', keyCode: 65, keyDown: true }

// Scroll wheel
{ type: 2, inputType: 'wheel', delta: 120 }
```

Coordinates are **absolute screen pixels** (not viewport-relative).
The server calls `user32.SendInput()` to inject the event.

---

### `CURSOR` (0x03) — Server → Client

Cursor shape change notification.

```typescript
{
  type:   3,
  x:      960,    // current screen X
  y:      540,    // current screen Y
  hotX:   0,      // cursor hotspot X (pixels from left)
  hotY:   0,      // cursor hotspot Y (pixels from top)
  width:  32,
  height: 32,
  data:   "…"    // base64 BGRA bitmap (width × height × 4 bytes)
}
```

**Client behaviour:**
- Convert BGRA → RGBA
- Paint to `OffscreenCanvas` → `convertToBlob()` → `URL.createObjectURL()`
- Set as `src` of a CSS-positioned `<img>` overlay
- Position: `left: x - hotX`, `top: y - hotY`

---

### `CLIPBOARD` (0x04) — Bidirectional

```typescript
// Text
{ type: 4, format: 'text', data: 'Hello, world!' }

// HTML
{ type: 4, format: 'html', data: '<b>Hello</b>' }

// Image (future)
{ type: 4, format: 'image/png', data: '<base64 PNG>' }
```

**Server → Client:** Client writes to `navigator.clipboard`
**Client → Server:** Server calls `SetClipboardData(CF_UNICODETEXT)`

---

### `PING` (0x05) — Bidirectional

RTT keepalive. Both sides echo the same timestamp back.

```typescript
{ type: 5, timestamp: 1718613600000 }
```

Client sends PING every 2 seconds.
Server responds immediately.
Client measures `Date.now() - sent` for RTT display.
ABR controller uses RTT samples for bitrate decisions.

---

### `AUTH` (0x06) — Bidirectional

**Client → Server (authenticate):**
```typescript
{ type: 6, token: '<base64url HMAC token>' }
```

**Server → Client (refresh):**
```typescript
{ type: 6, token: '<new session token>', sessionId: 'abc123' }
```

Server responds with a fresh session token after each successful auth.

**Token format** (base64url-decoded):
```
type:sessionId:expiry_unix_ms:hmac_sha256_hex
```

Types: `session` (1h), `refresh` (24h), `onetime` (single-use)

---

### `AUDIO` (0x07) — Server → Client

```typescript
{
  type:      7,
  timestamp: 1718613600000,
  data:      "…"   // base64 Opus packet (20ms frame, 48kHz stereo)
}
```

**Client behaviour:**
- Pass to `AudioDecoder.decode(new EncodedAudioChunk({ type: 'key', … }))`
- Output `AudioData` → `AudioWorklet` → `AudioContext.destination`

---

### `STATS` (0x08) — Server → Client

Sent every 5 seconds.

```typescript
{
  type:       8,
  fps:        30,
  bitrate:    2000000,   // bits/s current encoder bitrate
  rttMs:      45,        // latest RTT measurement
  dirtyRatio: 0.12       // fraction of screen that changed last frame
}
```

---

## Connection Flow

```
Client                              Server
  │                                   │
  │──── WebSocket upgrade ────────────▶│  (IP check, rate limit)
  │◀─── 101 Switching Protocols ───────│
  │                                   │
  │──── AUTH { token } ───────────────▶│  verifyToken()
  │◀─── AUTH { newToken, sessionId } ──│  issueToken()
  │                                   │
  │◀─── FRAME (keyframe) ──────────────│  first IDR frame
  │◀─── FRAME (delta) …  ─────────────│  continuous stream
  │◀─── AUDIO ────────────────────────│  20ms Opus packets
  │                                   │
  │──── INPUT { mouse } ──────────────▶│  SendInput()
  │──── INPUT { keyboard } ───────────▶│  SendInput()
  │                                   │
  │──── PING ─────────────────────────▶│
  │◀─── PING ──────────────────────────│  (RTT sample)
  │                                   │
  │──── CLIPBOARD ─────────────────────▶│  SetClipboardData()
  │◀─── CLIPBOARD ─────────────────────│  clipboard change
  │                                   │
  │◀─── CURSOR ────────────────────────│  cursor changed
  │◀─── STATS ─────────────────────────│  every 5s
  │                                   │
  │──── close ─────────────────────────▶│
```
