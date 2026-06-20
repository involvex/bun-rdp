import { MessageType, decodeMessage, encodeMessage } from '../packages/core-protocol';
import { CanvasRenderer } from './renderer/canvas';
import { WebCodecsDecoder, isWebCodecsSupported } from './renderer/webcodecs';
import { WebGPURenderer } from './renderer/webgpu';

const SERVER = process.env.SERVER ?? 'ws://localhost:9001';
const TOKEN = process.env.TOKEN ?? '';

// ── WebSocket ──────────────────────────────────────────────────────────────
const ws = new WebSocket(SERVER);
ws.binaryType = 'arraybuffer';

let decoder: WebCodecsDecoder | null = null;
let renderer: WebGPURenderer | CanvasRenderer | null = null;
let canvas: HTMLCanvasElement | null = null;

ws.onopen = async () => {
  console.log('[client] Connected →', SERVER);
  ws.send(encodeMessage({ type: MessageType.AUTH, token: TOKEN }));

  // Set up canvas (Node/Bun: use OffscreenCanvas or skip for headless)
  if (typeof document !== 'undefined') {
    canvas =
      (document.getElementById('remote') as HTMLCanvasElement) ?? document.createElement('canvas');
  }

  const webCodecsOk = typeof VideoDecoder !== 'undefined' && (await isWebCodecsSupported());
  console.log('[client] WebCodecs:', webCodecsOk ? '✅' : '❌ (will use Canvas2D)');
};

ws.onmessage = async ({ data }) => {
  const buf = new Uint8Array(data as ArrayBuffer);
  const msg = decodeMessage(buf);

  switch (msg.type) {
    case MessageType.FRAME: {
      if (!canvas) break;

      // Lazy-init decoder + renderer on first frame (we now know dimensions)
      if (!decoder) {
        const webCodecsOk = await isWebCodecsSupported();

        if (webCodecsOk) {
          decoder = new WebCodecsDecoder({ canvas: canvas! });
          await decoder.init(msg.width, msg.height);

          // Try WebGPU renderer — fall back to Canvas 2D
          const gpu = new WebGPURenderer(canvas);
          if (await gpu.init(msg.width, msg.height)) {
            renderer = gpu;
            // Override decoder's onFrame to use WebGPU
            decoder = new WebCodecsDecoder({
              canvas: canvas!,
              onFrame: (frame) => {
                (renderer as WebGPURenderer).renderFrame(frame);
                frame.close();
              },
            });
            await decoder.init(msg.width, msg.height);
          } else {
            renderer = new CanvasRenderer(canvas);
          }
        } else {
          // No WebCodecs — fallback Canvas2D + raw BGRA (if server sends uncompressed)
          renderer = new CanvasRenderer(canvas);
        }
      }

      if (decoder?.isReady) {
        decoder.decode(msg.data, msg.keyframe ?? false, msg.timestamp);
      }
      break;
    }

    case MessageType.PING:
      ws.send(encodeMessage({ type: MessageType.PING, timestamp: Date.now() }));
      break;
  }
};

ws.onclose = () => {
  console.log('[client] Disconnected');
  decoder?.dispose();
  renderer?.dispose?.();
};

ws.onerror = (e) => console.error('[client] Error', e);
