import { WsTransport }             from '../packages/transport';
import { ScreenCapture }             from '../packages/screen-capture';
import { DirtyRectTracker }          from '../packages/screen-capture/dirty-rect';
import { H264Encoder }               from '../packages/encoder';
import { AdaptiveBitrateController } from '../packages/adaptive-bitrate';
import { WASAPILoopback }            from '../packages/audio';
import { ClipboardMonitor }          from '../packages/clipboard';
import { CursorCapture }             from '../packages/cursor';
import { verifyToken }               from '../packages/auth';
import { MessageType, type RdpMessage } from '../packages/core-protocol';
import { sendMouseMove, sendMouseButton, sendKeyboardInput, sendMouseWheel } from '../packages/input';
import { log } from '../packages/utils';

const PORT    = Number(process.env.PORT    ?? 9001);
const FPS     = Number(process.env.FPS     ?? 30);
const BITRATE = Number(process.env.BITRATE ?? 2_000_000);
const AUDIO   = process.env.AUDIO !== 'false';

async function main() {
  // ── Screen capture ────────────────────────────────────────────────────────
  const capture = new ScreenCapture();
  const backend = capture.init();
  log.info('server', `Capture: ${backend}`);
  const { width, height } = capture.dimensions;

  // ── Dirty-rect tracker ────────────────────────────────────────────────────
  const dirtyTracker = new DirtyRectTracker(width, height);
  // DirtyRectTracker.attach() called inside capture after AcquireNextFrame
  // (wired via capture.onDuplication callback — set after init)

  // ── H.264 encoder ─────────────────────────────────────────────────────────
  const encoder = new H264Encoder({ width, height, fps: FPS, bitrate: BITRATE });
  await encoder.init();

  // ── Adaptive bitrate ──────────────────────────────────────────────────────
  const abr = new AdaptiveBitrateController({
    initialBitrate: BITRATE,
    onBitrateChange: (br) => {
      log.info('abr', `→ ${(br / 1000).toFixed(0)} kbps`);
      // TODO: encoder.setBitrate(br) — dynamic bitrate update via MF attr
    },
  });

  // ── WebSocket transport ───────────────────────────────────────────────────
  const transport = new WsTransport(PORT);

  // Track per-client ping timestamps
  const pings = new Map<string, number>();

  transport.on('connect',    (id) => { log.info('server', `+ ${id}`); pings.set(id, 0); });
  transport.on('disconnect', (id) => { log.info('server', `- ${id}`); pings.delete(id); });

  transport.on('message', (clientId: string, msg: RdpMessage) => {
    switch (msg.type) {
      case MessageType.AUTH: {
        const sid = verifyToken(msg.token);
        if (sid) { transport.setAuthenticated(clientId); log.info('server', `Auth OK ${clientId}`); }
        else      { log.warn('server', `Auth FAIL ${clientId}`); }
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
        const rtt  = Date.now() - sent;
        abr.addSample(rtt);
        transport.send(clientId, { type: MessageType.PING, timestamp: Date.now() });
        break;
      }
      case MessageType.CLIPBOARD: {
        clipboard.setClipboard({ format: msg.format as 'text' | 'html' | 'image/png', data: msg.data });
        break;
      }
    }
  });

  transport.start();

  // ── Clipboard monitor ─────────────────────────────────────────────────────
  const clipboard = new ClipboardMonitor((payload) => {
    transport.broadcast({ type: MessageType.CLIPBOARD, format: payload.format, data: payload.data });
    log.info('clipboard', `Sent: ${payload.format}`);
  });
  clipboard.start();

  // ── Cursor capture ────────────────────────────────────────────────────────
  const cursorCap = new CursorCapture();

  // ── Audio capture ─────────────────────────────────────────────────────────
  if (AUDIO) {
    try {
      const audio = new WASAPILoopback({
        bitrate:  96_000,
        onPacket: (packet, ts) => {
          transport.broadcast({ type: MessageType.AUDIO, timestamp: ts, data: packet });
        },
      });
      await audio.init();
      audio.start();
    } catch (e) {
      log.warn('audio', `WASAPI unavailable: ${e}`);
    }
  }

  // ── Capture + encode loop ─────────────────────────────────────────────────
  let frameCount    = 0;
  let skipCount     = 0;
  const interval    = Math.floor(1000 / FPS);

  setInterval(() => {
    const frame = capture.captureFrame(interval);
    if (!frame) { skipCount++; return; }

    // Query dirty rects (only meaningful for DXGI backend)
    const dirty = backend === 'dxgi' ? dirtyTracker.query() : null;
    const isFullFrame = !dirty || dirty.fullFrame;

    // Skip encoding if nothing changed (all rects empty)
    if (dirty && dirty.dirtyRects.length === 0 && !dirty.fullFrame) {
      skipCount++;
      return;
    }

    const encoded = encoder.encodeFrame(frame.data);
    if (!encoded) return;

    transport.broadcast({
      type:      MessageType.FRAME,
      timestamp: Date.now(),
      width,
      height,
      keyframe:  encoded.keyframe,
      rects:     isFullFrame ? undefined : dirty?.dirtyRects,
      data:      encoded.data,
    });

    // Cursor shape update
    const cursorMsg = cursorCap.poll();
    if (cursorMsg) transport.broadcast(cursorMsg);

    frameCount++;
    if (frameCount % (FPS * 30) === 0) {
      const stats = abr.stats();
      log.info('server', `frames=${frameCount} skipped=${skipCount} rtt=${stats.avgRtt}ms br=${(stats.bitrate/1000).toFixed(0)}kbps`);
    }
  }, interval);

  log.info('server',
    `bun-rdp ready — ws://localhost:${PORT}  ${width}x${height}@${FPS}fps  audio=${AUDIO}`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
