import { MessageType, encodeMessage, decodeMessage } from '../../packages/core-protocol';
import { attachInputCapture } from '../../client/input-capture';
import { WebCodecsDecoder, isWebCodecsSupported } from '../../client/renderer/webcodecs';
import { WebGPURenderer }    from '../../client/renderer/webgpu';
import { CanvasRenderer }    from '../../client/renderer/canvas';

// ── DOM ───────────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('remote')  as HTMLCanvasElement;
const status   = document.getElementById('status')  as HTMLElement;
const latEl    = document.getElementById('latency') as HTMLElement;

// ── State ─────────────────────────────────────────────────────────────────────
let decoder:  WebCodecsDecoder | null = null;
let renderer: WebGPURenderer | CanvasRenderer | null = null;
let lastPing = 0;

function setStatus(msg: string) {
  if (status) status.textContent = msg;
  console.log('[ui]', msg);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const SERVER  = params.get('server')  ?? `ws://${location.host}/ws`;
const TOKEN   = params.get('token')   ?? '';

const ws = new WebSocket(SERVER);
ws.binaryType = 'arraybuffer';
setStatus('Connecting…');

ws.onopen = () => {
  setStatus('Authenticating…');
  ws.send(encodeMessage({ type: MessageType.AUTH, token: TOKEN }));
  attachInputCapture(canvas, (data) => ws.send(data));

  // Start ping loop
  setInterval(() => {
    lastPing = Date.now();
    ws.send(encodeMessage({ type: MessageType.PING, timestamp: lastPing }));
  }, 2000);
};

ws.onmessage = async ({ data }) => {
  const msg = decodeMessage(new Uint8Array(data as ArrayBuffer));

  switch (msg.type) {
    case MessageType.FRAME: {
      // Init decoder + renderer on first frame
      if (!decoder) {
        setStatus('Initialising decoder…');
        const webCodecsOk = await isWebCodecsSupported();

        // 1. WebGPU + WebCodecs (best)
        const gpu = new WebGPURenderer(canvas);
        const gpuOk = await gpu.init(msg.width, msg.height);

        if (webCodecsOk && gpuOk) {
          renderer = gpu;
          decoder  = new WebCodecsDecoder({
            canvas,
            onFrame: (frame) => {
              (renderer as WebGPURenderer).renderFrame(frame);
              frame.close();
            },
          });
          setStatus('WebCodecs + WebGPU ✅');
        } else if (webCodecsOk) {
          // 2. WebCodecs + Canvas 2D
          renderer = new CanvasRenderer(canvas);
          decoder  = new WebCodecsDecoder({ canvas });
          setStatus('WebCodecs + Canvas2D ✅');
        } else {
          // 3. Canvas 2D raw fallback
          renderer = new CanvasRenderer(canvas);
          setStatus('Canvas2D fallback ⚠️');
        }

        if (decoder) await decoder.init(msg.width, msg.height);
      }

      decoder?.decode(msg.data, msg.keyframe ?? false, msg.timestamp);
      break;
    }

    case MessageType.PING: {
      const rtt = Date.now() - lastPing;
      if (latEl) latEl.textContent = `${rtt} ms`;
      break;
    }
  }
};

ws.onclose = () => {
  setStatus('Disconnected');
  decoder?.dispose();
};

ws.onerror = () => setStatus('Connection error ❌');
