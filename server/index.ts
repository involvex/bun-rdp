import { WsTransport } from '../packages/transport';
import { ScreenCapture } from '../packages/screen-capture';
import { H264Encoder } from '../packages/encoder';
import { verifyToken } from '../packages/auth';
import { MessageType, type RdpMessage } from '../packages/core-protocol';
import { sendMouseMove, sendMouseButton, sendKeyboardInput } from '../packages/input';
import { log } from '../packages/utils';

const PORT = Number(process.env.PORT ?? 9001);
const FPS  = Number(process.env.FPS  ?? 30);

async function main() {
  const capture  = new ScreenCapture();
  await capture.init();

  const { width, height } = capture.dimensions;
  const encoder  = new H264Encoder(width, height, 2_000_000, FPS);
  await encoder.init();

  const transport = new WsTransport(PORT);

  transport.on('connect', (id) => log.info('server', `Client ${id} connected`));
  transport.on('disconnect', (id) => log.info('server', `Client ${id} disconnected`));

  transport.on('message', (clientId, msg: RdpMessage) => {
    switch (msg.type) {
      case MessageType.AUTH: {
        const sessionId = verifyToken(msg.token);
        if (sessionId) {
          transport.setAuthenticated(clientId);
          log.info('server', `Client ${clientId} authenticated — session ${sessionId}`);
        } else {
          log.warn('server', `Client ${clientId} auth failed`);
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
    }
  });

  transport.start();

  // Capture loop
  const interval = Math.floor(1000 / FPS);
  setInterval(() => {
    const frame = capture.captureFrame(interval);
    if (!frame) return;
    const encoded = encoder.encodeFrame(frame);
    if (!encoded) return;
    transport.broadcast({
      type: MessageType.FRAME,
      timestamp: Date.now(),
      width,
      height,
      data: encoded,
    });
  }, interval);

  log.info('server', `bun-rdp server running on ws://localhost:${PORT}`);
}

main().catch(console.error);
