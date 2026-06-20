import { MessageType, encodeMessage } from '../packages/core-protocol';

export function attachInputCapture(canvas: HTMLCanvasElement, send: (data: Uint8Array) => void) {
  canvas.addEventListener('mousemove', (e) => {
    send(
      encodeMessage({
        type: MessageType.INPUT,
        inputType: 'mouse',
        x: e.clientX,
        y: e.clientY,
      })
    );
  });

  canvas.addEventListener('mousedown', (e) => {
    const btn = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';
    send(
      encodeMessage({
        type: MessageType.INPUT,
        inputType: 'mouse',
        button: btn as unknown as number,
        flags: 1,
      })
    );
  });

  canvas.addEventListener('mouseup', (e) => {
    const btn = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';
    send(
      encodeMessage({
        type: MessageType.INPUT,
        inputType: 'mouse',
        button: btn as unknown as number,
        flags: 0,
      })
    );
  });

  window.addEventListener('keydown', (e) => {
    send(
      encodeMessage({
        type: MessageType.INPUT,
        inputType: 'keyboard',
        keyCode: e.keyCode,
        keyDown: true,
      })
    );
  });

  window.addEventListener('keyup', (e) => {
    send(
      encodeMessage({
        type: MessageType.INPUT,
        inputType: 'keyboard',
        keyCode: e.keyCode,
        keyDown: false,
      })
    );
  });
}
