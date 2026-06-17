# Package API Reference

## packages/core-protocol

```typescript
import { MessageType, encodeMessage, decodeMessage } from './packages/core-protocol';
```

| Export | Description |
|---|---|
| `MessageType` | Enum of all message type IDs (0x01–0x08) |
| `encodeMessage(msg)` | `RdpMessage → Uint8Array` (4-byte length prefix + JSON) |
| `decodeMessage(buf)` | `Uint8Array → RdpMessage` |
| `RdpMessage` | Union type of all message interfaces |

---

## packages/screen-capture

```typescript
import { ScreenCapture } from './packages/screen-capture';
import { DirtyRectTracker, mergeRects } from './packages/screen-capture/dirty-rect';
```

### `ScreenCapture`
```typescript
const cap = new ScreenCapture();
const backend = cap.init(monitorIndex?: number);  // 'dxgi' | 'gdi32'
const frame = cap.captureFrame(timeoutMs?: number);  // CaptureFrame | null
cap.dispose();
```

### `DirtyRectTracker`
```typescript
const tracker = new DirtyRectTracker(screenWidth, screenHeight);
tracker.attach(dxgiDuplication);
const info = tracker.query();  // DirtyInfo
// info.dirtyRects, info.moveRects, info.fullFrame, info.dirtyRatio

DirtyRectTracker.cropBGRA(fullBuf, frameWidth, rect);  // Uint8Array (tile)
```

---

## packages/encoder

```typescript
import { H264Encoder, convertBGRAtoNV12 } from './packages/encoder';
```

### `H264Encoder`
```typescript
const enc = new H264Encoder({
  width, height,
  fps?: number,             // default 30
  bitrate?: number,         // default 2_000_000
  keyframeInterval?: number,// default fps*2
  hwAccel?: boolean,        // default true
});
await enc.init();
const result = enc.encodeFrame(bgraData);  // EncodedFrame | null
const frames = enc.flush();                // EncodedFrame[]
enc.dispose();
```

### `convertBGRAtoNV12(bgra, width, height)` → `Uint8Array`
Pure-TS BT.601 BGRA → NV12 conversion.

---

## packages/auth

```typescript
import { issueToken, issueRefreshToken, issueOneTimeToken, verifyToken, refreshSession, newSessionId } from './packages/auth';
```

| Function | Description |
|---|---|
| `issueToken(sessionId)` | Issue session token (1h) |
| `issueRefreshToken(sessionId)` | Issue refresh token (24h) |
| `issueOneTimeToken(sessionId)` | Issue one-time share token (1h, single-use) |
| `verifyToken(token)` | Verify any token → `VerifyResult \| null` |
| `refreshSession(refreshToken)` | Get new session+refresh pair → `{sessionToken, refreshToken} \| null` |
| `newSessionId()` | Generate a new random session ID |

---

## packages/security/ip-allowlist

```typescript
import { IPAllowlist } from './packages/security/ip-allowlist';
const list = new IPAllowlist({ rules: '192.168.0.0/16,::1' });
list.isAllowed('192.168.1.5');  // true
list.addRule('10.0.0.0/8');
list.removeRule('::1');
```

---

## packages/security/rate-limiter

```typescript
import { RateLimiter } from './packages/security/rate-limiter';
const limiter = new RateLimiter();
limiter.checkConnection(ip);   // boolean — false = deny
limiter.recordAuthFail(ip);    // boolean — false = now banned
limiter.unban(ip);
limiter.stats();               // Array<{ip, connections, authFails, banned}>
```

---

## packages/audit

```typescript
import { AuditLogger, FileAuditWriter } from './packages/audit';
const log = new AuditLogger(new FileAuditWriter('/path/to/dir'));
log.connect(ip, clientId);
log.authOk(ip, clientId, sessionId);
log.authFail(ip, clientId, detail?);
log.disconnect(ip, clientId);
// … see AuditLogger for all methods
```

---

## packages/wts

```typescript
import { enumerateSessions, getClientDisplay, isRemoteSession, disconnectSession, logoffSession } from './packages/wts';

const sessions = enumerateSessions();  // WtsSession[]
const disp = getClientDisplay(sessionId);  // WtsClientDisplay | null
const isRdp = isRemoteSession();       // boolean
disconnectSession(sessionId);
logoffSession(sessionId);
```

---

## packages/adaptive-bitrate

```typescript
import { AdaptiveBitrateController } from './packages/adaptive-bitrate';
const abr = new AdaptiveBitrateController({
  initialBitrate: 2_000_000,
  onBitrateChange: (br) => encoder.setBitrate(br),
});
abr.addSample(rttMs);  // call on each PONG received
abr.evaluate();         // force evaluation
abr.stats();            // { avgRtt, p95Rtt, bitrate }
```

---

## packages/audio

### Server
```typescript
import { WASAPILoopback } from './packages/audio';
const audio = new WASAPILoopback({
  bitrate?: number,        // Opus bitrate (default 96_000)
  application?: 'voip' | 'audio',
  onPacket: (packet, timestamp) => transport.broadcast(…),
});
await audio.init();
audio.start();
audio.stop();
audio.dispose();
```

### Browser
```typescript
import { OpusPlayer, isOpusSupported } from './packages/audio/client';
const ok = await isOpusSupported();
const player = new OpusPlayer();
await player.init();
await player.resume();  // must call after user gesture
player.decode(opusPacket, timestampMs);
player.dispose();
```
