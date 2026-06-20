// Core Protocol — Message Types & Binary Encoding

export const MessageType = {
  FRAME: 0x01,
  INPUT: 0x02,
  CURSOR: 0x03,
  CLIPBOARD: 0x04,
  PING: 0x05,
  AUTH: 0x06,
  AUDIO: 0x07,
  STATS: 0x08,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface FrameMessage {
  type: typeof MessageType.FRAME;
  timestamp: number;
  width: number;
  height: number;
  keyframe: boolean;
  /** Dirty rects encoded in this frame (null = full frame) */
  rects?: Array<{ x: number; y: number; w: number; h: number }>;
  data: Uint8Array; // H.264 Annex-B
}

export interface InputMessage {
  type: typeof MessageType.INPUT;
  inputType: 'mouse' | 'keyboard' | 'wheel';
  x?: number;
  y?: number;
  button?: number;
  delta?: number; // wheel delta
  keyCode?: number;
  keyDown?: boolean;
  flags?: number;
}

export interface CursorMessage {
  type: typeof MessageType.CURSOR;
  x: number;
  y: number;
  hotX: number;
  hotY: number;
  width: number;
  height: number;
  data: Uint8Array; // BGRA cursor bitmap
}

export interface ClipboardMessage {
  type: typeof MessageType.CLIPBOARD;
  format: 'text' | 'html' | 'image/png';
  data: string;
}

export interface AudioMessage {
  type: typeof MessageType.AUDIO;
  timestamp: number;
  data: Uint8Array; // Opus packet
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

export interface StatsMessage {
  type: typeof MessageType.STATS;
  fps: number;
  bitrate: number; // bits/s
  rttMs: number;
  dirtyRatio: number; // 0.0–1.0
}

export type RdpMessage =
  | FrameMessage
  | InputMessage
  | CursorMessage
  | ClipboardMessage
  | AudioMessage
  | PingMessage
  | AuthMessage
  | StatsMessage;

export function encodeMessage(msg: RdpMessage): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(msg));
  const buf = new Uint8Array(4 + body.byteLength);
  new DataView(buf.buffer).setUint32(0, body.byteLength, false);
  buf.set(body, 4);
  return buf;
}

export function decodeMessage(buf: Uint8Array): RdpMessage {
  return JSON.parse(new TextDecoder().decode(buf.slice(4))) as RdpMessage;
}
