import { MessageType, encodeMessage, decodeMessage } from '../packages/core-protocol';

const SERVER = process.env.SERVER ?? 'ws://localhost:9001';
const TOKEN  = process.env.TOKEN  ?? '';

const ws = new WebSocket(SERVER);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
  console.log('[client] Connected to', SERVER);
  // Authenticate
  ws.send(encodeMessage({ type: MessageType.AUTH, token: TOKEN }));
};

ws.onmessage = (event) => {
  const buf = new Uint8Array(event.data as ArrayBuffer);
  const msg = decodeMessage(buf);

  if (msg.type === MessageType.FRAME) {
    console.log(`[client] Frame received — ${msg.width}x${msg.height} @ ${msg.timestamp}`);
    // Hand off to renderer
  }
};

ws.onclose = () => console.log('[client] Disconnected');
ws.onerror = (e) => console.error('[client] Error', e);
