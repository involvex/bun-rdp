import { MessageType, encodeMessage, decodeMessage } from '../../packages/core-protocol';
import { attachInputCapture } from '../../client/input-capture';
import { CanvasRenderer } from '../../client/renderer/canvas';

const canvas = document.getElementById('remote') as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);
const ws = new WebSocket(`ws://${location.host}/ws`);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  ws.send(encodeMessage({ type: MessageType.AUTH, token }));
  attachInputCapture(canvas, (data) => ws.send(data));
};

ws.onmessage = ({ data }) => {
  const msg = decodeMessage(new Uint8Array(data as ArrayBuffer));
  if (msg.type === MessageType.FRAME) {
    renderer.renderFrame(msg.data, msg.width, msg.height);
  }
};
