import { WsTransport }             from '../packages/transport';
import { ScreenCapture }             from '../packages/screen-capture';
import { DirtyRectTracker }          from '../packages/screen-capture/dirty-rect';
import { H264Encoder }               from '../packages/encoder';
import { AdaptiveBitrateController } from '../packages/adaptive-bitrate';
import { WASAPILoopback }            from '../packages/audio';
import { ClipboardMonitor }          from '../packages/clipboard';
import { CursorCapture }             from '../packages/cursor';
import { loadTlsConfig }             from '../packages/tls';
import {
  issueToken, issueRefreshToken, issueOneTimeToken,
  refreshSession, verifyToken, newSessionId,
} from '../packages/auth';
import { MessageType, type RdpMessage } from '../packages/core-protocol';
import { sendMouseMove, sendKeyboardInput, sendMouseWheel } from '../packages/input';
import { log } from '../packages/utils';

const PORT    = Number(process.env.PORT    ?? 9001);
const FPS     = Number(process.env.FPS     ?? 30);
const BITRATE = Number(process.env.BITRATE ?? 2_000_000);
const AUDIO   = process.env.AUDIO !== 'false';

async function main() {
  // ── TLS ───────────────────────────────────────────────────────────────────
  const tlsCfg = await loadTlsConfig();
  const tls    = tlsCfg
    ? { cert: tlsCfg.cert, key: tlsCfg.key }
    : undefined;

  // ── Screen capture ────────────────────────────────────────────────────────
  const capture = new ScreenCapture();
  const backend = capture.init();
  log.info('server', `Capture: ${backend}`);
  const { width, height } = capture.dimensions;

  // ── Dirty-rect tracker ────────────────────────────────────────────────────
  const dirtyTracker = new DirtyRectTracker(width, height);

  // ── H.264 encoder ─────────────────────────────────────────────────────────
  const encoder = new H264Encoder({ width, height, fps: FPS, bitrate: BITRATE });
  await encoder.init();

  // ── ABR ───────────────────────────────────────────────────────────────────
  const abr = new AdaptiveBitrateController({
    initialBitrate:  BITRATE,
    onBitrateChange: (br) => log.info('abr', `→ ${(br / 1000).toFixed(0)} kbps`),
  });

  // ── Transport (with TLS, IP allowlist, rate limiter, audit log) ───────────
  const transport = new WsTransport(PORT, tls);
  const audit     = transport.audit;

  // Per-client state
  const pings      = new Map<string, number>();
  const clientIPs  = new Map<string, string>();

  transport.on('connect', (id, ip) => {
    pings.set(id, 0);
    clientIPs.set(id, ip);
    log.info('server', `+ ${id} (${ip})`);
  });

  transport.on('disconnect', (id, ip) => {
    pings.delete(id);
    clientIPs.delete(id);
    log.info('server', `- ${id} (${ip})`);
  });

  transport.on('message', (clientId: string, msg: RdpMessage) => {
    const ip = clientIPs.get(clientId) ?? '?';

    switch (msg.type) {
      case MessageType.AUTH: {
        const result = verifyToken(msg.token);
        if (result) {
          transport.setAuthenticated(clientId, result.sessionId);
          audit.authOk(ip, clientId, result.sessionId);

          // Issue fresh tokens on each auth
          const newSession = issueToken(result.sessionId);
          const newRefresh = issueRefreshToken(result.sessionId);
          transport.send(clientId, {
            type:  MessageType.AUTH,
            token: newSession,
            sessionId: result.sessionId,
          } as unknown as RdpMessage);
        } else {
          audit.authFail(ip, clientId, 'invalid or expired token');
          const stillOk = transport.recordAuthFail(ip, clientId);
          if (!stillOk) {
            // Rate limit triggered — close connection
            log.warn('server', `Rate-limited ${ip} — closing`);
          }
        }
        break;
      }

      case MessageType.INPUT: {
        if (msg.inputType === 'mouse')    sendMouseMove(msg.x ?? 0, msg.y ?? 0);
        if (msg.inputType === 'keyboard') sendKeyboardInput(msg.keyCode ?? 0, msg.keyDown ?? false);
        if (msg.inputType === 'wheel')    sendMouseWheel(msg.delta ?? 0);
        break;
      }

      case MessageType.PING: {
        const sent = pings.get(clientId) ?? msg.timestamp;
        abr.addSample(Date.now() - sent);
        transport.send(clientId, { type: MessageType.PING, timestamp: Date.now() });
        break;
      }

      case MessageType.CLIPBOARD: {
        audit.clipboardIn(clientId, msg.format);
        clipboard.setClipboard({ format: msg.format as 'text' | 'html' | 'image/png', data: msg.data });
        break;
      }
    }
  });

  transport.start();

  // ── Clipboard ─────────────────────────────────────────────────────────────
  const clipboard = new ClipboardMonitor((payload) => {
    transport.broadcast({ type: MessageType.CLIPBOARD, format: payload.format, data: payload.data });
  });
  clipboard.start();

  // ── Cursor ────────────────────────────────────────────────────────────────
  const cursorCap = new CursorCapture();

  // ── Audio ─────────────────────────────────────────────────────────────────
  if (AUDIO) {
    try {
      const audio = new WASAPILoopback({
        bitrate:  96_000,
        onPacket: (packet, ts) =>
          transport.broadcast({ type: MessageType.AUDIO, timestamp: ts, data: packet }),
      });
      await audio.init();
      audio.start();
    } catch (e) { log.warn('audio', `WASAPI unavailable: ${e}`); }
  }

  // ── Capture + encode loop ─────────────────────────────────────────────────
  let frameCount = 0, skipCount = 0;
  const interval = Math.floor(1000 / FPS);

  setInterval(() => {
    const frame = capture.captureFrame(interval);
    if (!frame) { skipCount++; return; }

    const dirty       = backend === 'dxgi' ? dirtyTracker.query() : null;
    const isFullFrame = !dirty || dirty.fullFrame;
    if (dirty && dirty.dirtyRects.length === 0 && !dirty.fullFrame) { skipCount++; return; }

    const encoded = encoder.encodeFrame(frame.data);
    if (!encoded) return;

    transport.broadcast({
      type:      MessageType.FRAME,
      timestamp: Date.now(),
      width, height,
      keyframe:  encoded.keyframe,
      rects:     isFullFrame ? undefined : dirty?.dirtyRects,
      data:      encoded.data,
    });

    const cursorMsg = cursorCap.poll();
    if (cursorMsg) transport.broadcast(cursorMsg);

    frameCount++;
    if (frameCount % (FPS * 30) === 0) {
      const s = abr.stats();
      log.info('server',
        `frames=${frameCount} skip=${skipCount} rtt=${s.avgRtt}ms p95=${s.p95Rtt}ms br=${(s.bitrate/1000).toFixed(0)}kbps`
      );
    }
  }, interval);

  // ── One-time token CLI helper ─────────────────────────────────────────────
  if (process.env.BUN_RDP_PRINT_TOKEN) {
    const sid   = newSessionId();
    const token = issueOneTimeToken(sid);
    const proto = tls ? 'wss' : 'ws';
    console.log(`\n🔗 Share link: ${proto}://localhost:${PORT}?token=${token}\n`);
  }

  log.info('server',
    `bun-rdp ready — ${tls ? 'wss' : 'ws'}://localhost:${PORT}  ` +
    `${width}x${height}@${FPS}fps  audio=${AUDIO}`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
