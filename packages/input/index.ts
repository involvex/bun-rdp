import { User32 } from '../win32-compat';

/** Move the mouse to absolute screen coordinates (0–65535 range) */
export function sendMouseMove(x: number, y: number) {
  const input = new User32.INPUT();
  input.type = User32.INPUT_MOUSE;
  input.mi.dx = Math.round((x / (screen?.width ?? 1920)) * 65535);
  input.mi.dy = Math.round((y / (screen?.height ?? 1080)) * 65535);
  input.mi.dwFlags = User32.MOUSEEVENTF_MOVE | User32.MOUSEEVENTF_ABSOLUTE;
  User32.SendInput(1, input.ref(), User32.sizeof_INPUT);
}

/** Send a mouse button event */
export function sendMouseButton(button: 'left' | 'right' | 'middle', down: boolean) {
  const flagMap = {
    left: down ? User32.MOUSEEVENTF_LEFTDOWN : User32.MOUSEEVENTF_LEFTUP,
    right: down ? User32.MOUSEEVENTF_RIGHTDOWN : User32.MOUSEEVENTF_RIGHTUP,
    middle: down ? User32.MOUSEEVENTF_MIDDLEDOWN : User32.MOUSEEVENTF_MIDDLEUP,
  };
  const input = new User32.INPUT();
  input.type = User32.INPUT_MOUSE;
  input.mi.dwFlags = flagMap[button];
  User32.SendInput(1, input.ref(), User32.sizeof_INPUT);
}

/** Send a keyboard key event */
export function sendKeyboardInput(vkCode: number, keyDown: boolean) {
  const input = new User32.INPUT();
  input.type = User32.INPUT_KEYBOARD;
  input.ki.wVk = vkCode;
  input.ki.dwFlags = keyDown ? 0 : User32.KEYEVENTF_KEYUP;
  User32.SendInput(1, input.ref(), User32.sizeof_INPUT);
}

/** Send a mouse wheel scroll event */
export function sendMouseWheel(delta: number) {
  const input = new User32.INPUT();
  input.type = User32.INPUT_MOUSE;
  input.mi.dwFlags = User32.MOUSEEVENTF_WHEEL;
  input.mi.mouseData = delta;
  User32.SendInput(1, input.ref(), User32.sizeof_INPUT);
}
