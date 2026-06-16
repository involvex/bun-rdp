// Core Protocol — Message Types & Binary Encoding

export const MessageType = {
  FRAME:     0x01,
  INPUT:     0x02,
  CURSOR:    0x03,
  CLIPBOARD: 0x04,
  PING:      0x05,
  AUTH:      0x06,
} as const;

export type MessageType = typeof MessageType[keyof typeof MessageType];

export interface FrameMessage {
  type: typeof MessageType.FRAME;
  timestamp: number;
  width: number;
  height: number;
  data: Uint8Array; // H.264 Annex-B
}

export interface InputMessage {
  type: typeof MessageType.INPUT;
  inputType: 'mouse' | 'keyboard';
  x?: number;
  y?: number;
  button?: number;
  keyCode?: number;
  keyDown?: boolean;
  flags?: number;
}

export interface CursorMessage {
  type: typeof MessageType.CURSOR;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array; // BGRA cursor bitmap
}

export interface ClipboardMessage {
  type: typeof MessageType.CLIPBOARD;
  format: 'text' | 'html';
  data: string;
}

export interface PingMessage {
  type: typeof MessageType.PING;
  timestamp: number;
}

export interface AuthMessage {
  type: typeof MessageType.AUTH;
  token: string;
  sessionId?: string;
}

export type RdpMessage =
  | FrameMessage
  | InputMessage
  | CursorMessage
  | ClipboardMessage
  | PingMessage
  | AuthMessage;

/** Encode a message to binary (length-prefixed) */
export function encodeMessage(msg: RdpMessage): Uint8Array {
  const json = JSON.stringify(msg);
  const body = new TextEncoder().encode(json);
  const buf = new Uint8Array(4 + body.byteLength);
  new DataView(buf.buffer).setUint32(0, body.byteLength, false);
  buf.set(body, 4);
  return buf;
}

/** Decode a binary message */
export function decodeMessage(buf: Uint8Array): RdpMessage {
  const json = new TextDecoder().decode(buf.slice(4));
  return JSON.parse(json) as RdpMessage;
}
