import { attachInputCapture } from '../../client/input-capture';
import { CanvasRenderer } from '../../client/renderer/canvas';
import { isWebCodecsSupported, WebCodecsDecoder } from '../../client/renderer/webcodecs';
import { WebGPURenderer } from '../../client/renderer/webgpu';
import { isOpusSupported, OpusPlayer } from '../../packages/audio/client';
import {
  decodeMessage,
  encodeMessage,
  MessageType,
  type StatsMessage,
} from '../../packages/core-protocol';

// ── DOM ───────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('remote') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement;
const rttEl = document.getElementById('rtt') as HTMLElement;
const fpsEl = document.getElementById('fps') as HTMLElement;
const brEl = document.getElementById('bitrate') as HTMLElement;
const cursorEl = document.getElementById('cursor') as HTMLImageElement;

// ── State ─────────────────────────────────────────────────────────────────────
let decoder: WebCodecsDecoder | null = null;
let renderer: WebGPURenderer | CanvasRenderer | null = null;
let audioPlayer: OpusPlayer | null = null;
let lastPing = 0;
let frameCount = 0;
let fpsTimer = Date.now();

function setStatus(s: string) {
  if (statusEl) statusEl.textContent = s;
}

// ── Cursor overlay ────────────────────────────────────────────────────────────
function updateCursor(
  x: number,
  y: number,
  hotX: number,
  hotY: number,
  w: number,
  h: number,
  bgra: Uint8Array
) {
  if (!cursorEl) return;
  // Convert BGRA → RGBA for ImageData
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; // R
    rgba[i + 1] = bgra[i + 1]; // G
    rgba[i + 2] = bgra[i]; // B
    rgba[i + 3] = bgra[i + 3]; // A
  }
  const offscreen = new OffscreenCanvas(w, h);
  const ctx = offscreen.getContext('2d')!;
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  offscreen.convertToBlob({ type: 'image/png' }).then((blob) => {
    const url = URL.createObjectURL(blob);
    if (cursorEl.src) URL.revokeObjectURL(cursorEl.src);
    cursorEl.src = url;
    cursorEl.style.cssText = `position:fixed;left:${x - hotX}px;top:${y - hotY}px;pointer-events:none;z-index:999;width:${w}px;height:${h}px`;
  });
}

// ── Clipboard sync ────────────────────────────────────────────────────────────
document.addEventListener('paste', async (e) => {
  const text = e.clipboardData?.getData('text/plain');
  if (text && ws.readyState === WebSocket.OPEN) {
    ws.send(encodeMessage({ type: MessageType.CLIPBOARD, format: 'text', data: text }));
  }
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SERVER = params.get('server') ?? `ws://${location.host}/ws`;
const TOKEN = params.get('token') ?? '';

const ws = new WebSocket(SERVER);
ws.binaryType = 'arraybuffer';
setStatus('Connecting…');

ws.onopen = async () => {
  setStatus('Authenticating…');
  ws.send(encodeMessage({ type: MessageType.AUTH, token: TOKEN }));
  attachInputCapture(canvas, (data) => ws.send(data));

  // Init audio on user gesture / connection
  if (await isOpusSupported()) {
    audioPlayer = new OpusPlayer();
    await audioPlayer.init();
    await audioPlayer.resume();
  }

  // Ping loop
  setInterval(() => {
    lastPing = Date.now();
    ws.send(encodeMessage({ type: MessageType.PING, timestamp: lastPing }));
  }, 2000);
};

ws.onmessage = async ({ data }) => {
  const msg = decodeMessage(new Uint8Array(data as ArrayBuffer));

  switch (msg.type) {
    case MessageType.FRAME: {
      // FPS counter
      frameCount++;
      if (Date.now() - fpsTimer >= 1000) {
        if (fpsEl) fpsEl.textContent = `${frameCount} fps`;
        frameCount = 0;
        fpsTimer = Date.now();
      }

      if (!decoder) {
        setStatus('Init renderer…');
        const webCodecsOk = await isWebCodecsSupported();
        const gpu = new WebGPURenderer(canvas);
        const gpuOk = await gpu.init(msg.width, msg.height);

        if (webCodecsOk && gpuOk) {
          renderer = gpu;
          decoder = new WebCodecsDecoder({
            canvas,
            onFrame: (frame) => {
              (renderer as WebGPURenderer).renderFrame(frame);
              frame.close();
            },
          });
          setStatus('WebGPU + WebCodecs ✅');
        } else if (webCodecsOk) {
          renderer = new CanvasRenderer(canvas);
          decoder = new WebCodecsDecoder({ canvas });
          setStatus('Canvas + WebCodecs ✅');
        } else {
          renderer = new CanvasRenderer(canvas);
          setStatus('Canvas2D fallback ⚠️');
        }
        if (decoder) await decoder.init(msg.width, msg.height);
      }

      decoder?.decode(msg.data, msg.keyframe, msg.timestamp);
      break;
    }

    case MessageType.AUDIO: {
      audioPlayer?.decode(msg.data, msg.timestamp);
      break;
    }

    case MessageType.CURSOR: {
      updateCursor(msg.x, msg.y, msg.hotX, msg.hotY, msg.width, msg.height, msg.data);
      break;
    }

    case MessageType.CLIPBOARD: {
      if (msg.format === 'text') {
        navigator.clipboard?.writeText(msg.data).catch(() => {});
      }
      break;
    }

    case MessageType.PING: {
      const rtt = Date.now() - lastPing;
      if (rttEl) rttEl.textContent = `${rtt} ms`;
      break;
    }

    case MessageType.STATS: {
      const s = msg as unknown as StatsMessage;
      if (brEl) brEl.textContent = `${(s.bitrate / 1000).toFixed(0)} kbps`;
      if (fpsEl) fpsEl.textContent = `${s.fps} fps`;
      if (rttEl) rttEl.textContent = `${s.rttMs} ms`;
      break;
    }
  }
};

ws.onclose = () => {
  setStatus('Disconnected ❌');
  decoder?.dispose();
  audioPlayer?.dispose();
};
ws.onerror = () => setStatus('Error ❌');
