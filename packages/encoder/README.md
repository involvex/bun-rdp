# encoder — H.264 Media Foundation Pipeline

Full H.264 encoding pipeline via Windows Media Foundation.

## Flow

```
BGRA frame (Uint8Array)
  ↓  convertBGRAtoNV12()      BT.601 limited-range, 2×2 UV downsampling
NV12 frame
  ↓  IMFSample → IMFSinkWriter
MF H.264 Encoder (hardware if available, software fallback)
  ↓  _drainOutput()
Annex-B NAL units (Uint8Array)  ← ready to send over WebSocket
```

## Usage

```ts
import { H264Encoder } from '.';

const enc = new H264Encoder({ width: 1920, height: 1080, fps: 30, bitrate: 4_000_000 });
await enc.init();

// In your capture loop:
const bgraFrame = capture.captureFrame();
if (bgraFrame) {
  const encoded = enc.encodeFrame(bgraFrame.data);
  if (encoded) {
    transport.broadcast({ type: MessageType.FRAME, ...encoded });
  }
}

enc.dispose();
```

## Config

| Option | Default | Description |
|---|---|---|
| `width` / `height` | required | Frame dimensions |
| `fps` | 30 | Frames per second |
| `bitrate` | 2 000 000 | Target bitrate (bits/s) |
| `keyframeInterval` | fps×2 | Keyframe every N frames |
| `hwAccel` | true | Prefer hardware encoder |

## Notes

- MF timestamps are in **100-nanosecond units** — the encoder handles conversion.
- The encoder buffers a few frames before emitting the first NAL — `encodeFrame()` may return `null` for the first 1–3 calls.
- Call `flush()` before `dispose()` to drain buffered frames.
- `convertBGRAtoNV12` is a pure-TS CPU-side conversion. For higher throughput, replace with a HLSL compute shader or a Media Foundation color converter MFT.
