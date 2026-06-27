import { AdaptiveBitrateController } from '../packages/adaptive-bitrate';
import { WASAPILoopback } from '../packages/audio';
import { issueOneTimeToken, issueToken, newSessionId, verifyToken } from '../packages/auth';
import { ClipboardMonitor } from '../packages/clipboard';
import { MessageType, type RdpMessage } from '../packages/core-protocol';
import { CursorCapture } from '../packages/cursor';
import { H264Encoder } from '../packages/encoder';
import { sendKeyboardInput, sendMouseMove, sendMouseWheel } from '../packages/input';
import { ScreenCapture } from '../packages/screen-capture';
import { DirtyRectTracker } from '../packages/screen-capture/dirty-rect';
import { loadTlsConfig } from '../packages/tls';
import { WsTransport } from '../packages/transport';
import { log } from '../packages/utils';
import { TrayIcon } from '../scripts/tray';
import { checkForUpdates } from '../scripts/updater';

const PORT = Number(process.env.PORT ?? 9001);
const FPS = Number(process.env.FPS ?? 30);
const BITRATE = Number(process.env.BITRATE ?? 2_000_000);
const AUDIO = process.env.AUDIO !== 'false';
const TRAY = process.env.BUN_RDP_TRAY !== 'false';
const HEADLESS = process.env.BUN_RDP_HEADLESS === 'true'; // service mode
const NO_AUTH = process.env.BUN_RDP_NO_AUTH === 'true'; // dev mode — skip auth

// ── CLI flags ─────────────────────────────────────────────────────────────────
if (process.argv.includes('--gen-secret')) {
  const { randomBytes } = await import('node:crypto');
  console.log(randomBytes(32).toString('hex'));
  process.exit(0);
}

async function main() {
  // ── Auto-updater (non-blocking) ───────────────────────────────────────────
  checkForUpdates().catch(() => {});

  // ── TLS ───────────────────────────────────────────────────────────────────
  const tlsCfg = await loadTlsConfig();
  const tls = tlsCfg ? { cert: tlsCfg.cert, key: tlsCfg.key } : undefined;

  // ── Screen capture ────────────────────────────────────────────────────────
  const capture = new ScreenCapture();
  const backend = capture.init();
  log.info('server', `Capture: ${backend}`);
  const { width, height } = capture.dimensions;

  // ── Encoder + ABR ─────────────────────────────────────────────────────────
  const encoder = new H264Encoder({
    width,
    height,
    fps: FPS,
    bitrate: BITRATE,
  });
  await encoder.init();

  const abr = new AdaptiveBitrateController({
    initialBitrate: BITRATE,
    onBitrateChange: (br) => log.info('abr', `→ ${(br / 1000).toFixed(0)} kbps`),
  });

  // ── Transport ─────────────────────────────────────────────────────────────
  const transport = new WsTransport(PORT, tls);
  const audit = transport.audit;
  const dirtyTracker = new DirtyRectTracker(width, height);

  const pings = new Map<string, number>();
  const clientIPs = new Map<string, string>();

  transport.on('connect', (id, ip) => {
    pings.set(id, 0);
    clientIPs.set(id, ip);
  });
  transport.on('disconnect', (id, _ip) => {
    pings.delete(id);
    clientIPs.delete(id);
  });

  transport.on('message', (clientId: string, msg: RdpMessage) => {
    const ip = clientIPs.get(clientId) ?? '?';
    switch (msg.type) {
      case MessageType.AUTH: {
        if (NO_AUTH) {
          const sid = newSessionId();
          transport.setAuthenticated(clientId, sid);
          audit.authOk(ip, clientId, sid);
          transport.send(clientId, {
            type: MessageType.AUTH,
            token: issueToken(sid),
            sessionId: sid,
          } as unknown as RdpMessage);
        } else {
          const result = verifyToken(msg.token);
          if (result) {
            transport.setAuthenticated(clientId, result.sessionId);
            audit.authOk(ip, clientId, result.sessionId);
            transport.send(clientId, {
              type: MessageType.AUTH,
              token: issueToken(result.sessionId),
              sessionId: result.sessionId,
            } as unknown as RdpMessage);
          } else {
            audit.authFail(ip, clientId);
            transport.recordAuthFail(ip, clientId);
          }
        }
        break;
      }
      case MessageType.INPUT:
        if (msg.inputType === 'mouse') sendMouseMove(msg.x ?? 0, msg.y ?? 0);
        if (msg.inputType === 'keyboard') sendKeyboardInput(msg.keyCode ?? 0, msg.keyDown ?? false);
        if (msg.inputType === 'wheel') sendMouseWheel(msg.delta ?? 0);
        break;
      case MessageType.PING:
        abr.addSample(Date.now() - (pings.get(clientId) ?? msg.timestamp));
        transport.send(clientId, {
          type: MessageType.PING,
          timestamp: Date.now(),
        });
        break;
      case MessageType.CLIPBOARD:
        audit.clipboardIn(clientId, msg.format);
        clipboard.setClipboard({
          format: msg.format as 'text' | 'html' | 'image/png',
          data: msg.data,
        });
        break;
    }
  });

  transport.start();

  // ── Clipboard + Cursor ────────────────────────────────────────────────────
  const clipboard = new ClipboardMonitor((payload) =>
    transport.broadcast({
      type: MessageType.CLIPBOARD,
      format: payload.format,
      data: payload.data,
    })
  );
  clipboard.start();
  const cursorCap = new CursorCapture();

  // ── Audio ─────────────────────────────────────────────────────────────────
  if (AUDIO) {
    try {
      const audio = new WASAPILoopback({
        bitrate: 96_000,
        onPacket: (packet, ts) =>
          transport.broadcast({
            type: MessageType.AUDIO,
            timestamp: ts,
            data: packet,
          }),
      });
      await audio.init();
      audio.start();
    } catch (e) {
      log.warn('audio', `WASAPI unavailable: ${e}`);
    }
  }

  // ── System tray ───────────────────────────────────────────────────────────
  if (TRAY && !HEADLESS) {
    const sid = newSessionId();
    const token = issueOneTimeToken(sid);
    const proto = tls ? 'wss' : 'ws';
    const shareLink = `${proto}://localhost:${PORT}?token=${token}`;

    const trayIcon = new TrayIcon({
      port: PORT,
      getConnCount: () => transport.connectedCount,
      getShareLink: () => shareLink,
      onStop: () => {
        log.info('server', 'Stopping via tray…');
        process.exit(0);
      },
    });
    try {
      trayIcon.init();
    } catch (e) {
      log.warn('tray', `System tray unavailable: ${e}`);
    }
  }

  // ── One-time token CLI ────────────────────────────────────────────────────
  if (process.env.BUN_RDP_PRINT_TOKEN) {
    const sid = newSessionId();
    const token = issueOneTimeToken(sid);
    const proto = tls ? 'wss' : 'ws';
    console.log(`\n🔗 Share: ${proto}://localhost:${PORT}?token=${token}\n`);
  }

  // ── Capture + encode loop ─────────────────────────────────────────────────
  let frameCount = 0;
  let skipCount = 0;
  const interval = Math.floor(1000 / FPS);

  setInterval(() => {
    const frame = capture.captureFrame(interval);
    if (!frame) {
      skipCount++;
      return;
    }

    const dirty = backend === 'dxgi' ? dirtyTracker.query() : null;
    const isFullFrame = !dirty || dirty.fullFrame;
    if (dirty && dirty.dirtyRects.length === 0 && !dirty.fullFrame) {
      skipCount++;
      return;
    }

    const encoded = encoder.encodeFrame(frame.data);
    if (!encoded) return;

    transport.broadcast({
      type: MessageType.FRAME,
      timestamp: Date.now(),
      width,
      height,
      keyframe: encoded.keyframe,
      rects: isFullFrame ? undefined : dirty?.dirtyRects,
      data: encoded.data,
    });

    const cursorMsg = cursorCap.poll();
    if (cursorMsg) transport.broadcast(cursorMsg);

    frameCount++;
    if (frameCount % (FPS * 30) === 0) {
      const s = abr.stats();
      log.info(
        'server',
        `frames=${frameCount} skip=${skipCount} rtt=${s.avgRtt}ms br=${(s.bitrate / 1000).toFixed(0)}kbps`
      );
    }
  }, interval);

  log.info(
    'server',
    `bun-rdp ready — ${tls ? 'wss' : 'ws'}://localhost:${PORT}  ${width}x${height}@${FPS}fps`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
