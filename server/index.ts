import { WsTransport }    from '../packages/transport';
import { ScreenCapture }  from '../packages/screen-capture';
import { H264Encoder }    from '../packages/encoder';
import { verifyToken }    from '../packages/auth';
import { MessageType, type RdpMessage } from '../packages/core-protocol';
import { sendMouseMove, sendMouseButton, sendKeyboardInput } from '../packages/input';
import { log } from '../packages/utils';

const PORT    = Number(process.env.PORT    ?? 9001);
const FPS     = Number(process.env.FPS     ?? 30);
const BITRATE = Number(process.env.BITRATE ?? 2_000_000);

async function main() {
  // ── Screen capture ────────────────────────────────────────────────────────
  const capture = new ScreenCapture();
  const backend = capture.init();
  log.info('server', `Capture backend: ${backend}`);

  const { width, height } = capture.dimensions;

  // ── H.264 encoder ─────────────────────────────────────────────────────────
  const encoder = new H264Encoder({ width, height, fps: FPS, bitrate: BITRATE });
  await encoder.init();

  // ── WebSocket transport ───────────────────────────────────────────────────
  const transport = new WsTransport(PORT);

  transport.on('connect',    (id) => log.info('server', `+ ${id}`));
  transport.on('disconnect', (id) => log.info('server', `- ${id}`));

  transport.on('message', (clientId: string, msg: RdpMessage) => {
    switch (msg.type) {
      case MessageType.AUTH: {
        const sid = verifyToken(msg.token);
        if (sid) {
          transport.setAuthenticated(clientId);
          log.info('server', `Auth OK: ${clientId} → session ${sid}`);
        } else {
          log.warn('server', `Auth FAIL: ${clientId}`);
        }
        break;
      }
      case MessageType.INPUT: {
        if (msg.inputType === 'mouse' && msg.x != null && msg.y != null) {
          sendMouseMove(msg.x, msg.y);
        } else if (msg.inputType === 'keyboard' && msg.keyCode != null) {
          sendKeyboardInput(msg.keyCode, msg.keyDown ?? false);
        }
        break;
      }
      case MessageType.PING: {
        transport.send(clientId, { type: MessageType.PING, timestamp: Date.now() });
        break;
      }
    }
  });

  transport.start();

  // ── Capture + encode loop ─────────────────────────────────────────────────
  let frameCount = 0;
  const interval = Math.floor(1000 / FPS);

  setInterval(() => {
    const frame = capture.captureFrame(interval);
    if (!frame) return;

    const encoded = encoder.encodeFrame(frame.data);
    if (!encoded)  return;  // encoder buffering initial frames

    transport.broadcast({
      type:      MessageType.FRAME,
      timestamp: Date.now(),
      width,
      height,
      keyframe:  encoded.keyframe,
      data:      encoded.data,
    });

    frameCount++;
    if (frameCount % (FPS * 10) === 0) {
      log.info('server', `${frameCount} frames sent`);
    }
  }, interval);

  log.info('server',
    `bun-rdp running — ws://localhost:${PORT}  ` +
    `${width}x${height}@${FPS}fps  ${BITRATE / 1000}kbps`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
