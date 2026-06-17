/**
 * Clipboard sync — server side (Windows)
 * Monitors the clipboard for changes and sends CLIPBOARD messages.
 * Receives CLIPBOARD messages from clients and sets clipboard content.
 *
 * Supports: plain text, HTML, PNG images
 *
 * Win32 APIs:
 *   OpenClipboard / CloseClipboard / GetClipboardData / SetClipboardData
 *   AddClipboardFormatListener (WM_CLIPBOARDUPDATE)
 */
import { User32, Kernel32 } from 'bun-win32';

export type ClipboardFormat = 'text' | 'html' | 'image/png';

export interface ClipboardPayload {
  format: ClipboardFormat;
  data:   string;          // text/html: UTF-8 string; image/png: base64
}

export type ClipboardChangeHandler = (payload: ClipboardPayload) => void;

// ─── Win32 clipboard format IDs ──────────────────────────────────────────────
const CF_UNICODETEXT   = 13;
const CF_DIB           = 8;
const CF_HTML          = () => User32.RegisterClipboardFormatW('HTML Format');

// ─── ClipboardMonitor ─────────────────────────────────────────────────────────

export class ClipboardMonitor {
  private onChange: ClipboardChangeHandler;
  private running  = false;
  private lastSeq  = -1;
  private cfHtml   = 0;

  constructor(onChange: ClipboardChangeHandler) {
    this.onChange = onChange;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.cfHtml  = CF_HTML();
    this._poll();
    console.log('[clipboard] Monitor started');
  }

  stop(): void { this.running = false; }

  // ── Poll clipboard sequence number (cheap, no window needed) ─────────────
  private _poll(): void {
    if (!this.running) return;
    try {
      const seq = User32.GetClipboardSequenceNumber() as number;
      if (seq !== this.lastSeq) {
        this.lastSeq = seq;
        const payload = this._read();
        if (payload) this.onChange(payload);
      }
    } catch { /* ignore */ }
    setTimeout(() => this._poll(), 500);
  }

  private _read(): ClipboardPayload | null {
    if (!User32.OpenClipboard(null)) return null;
    try {
      // Try HTML first
      if (this.cfHtml) {
        const hMem = User32.GetClipboardData(this.cfHtml);
        if (hMem) {
          const ptr = Kernel32.GlobalLock(hMem);
          const raw = readCString(ptr);
          Kernel32.GlobalUnlock(hMem);
          const html = parseHtmlClipboard(raw);
          if (html) return { format: 'html', data: html };
        }
      }

      // Plain text
      const hText = User32.GetClipboardData(CF_UNICODETEXT);
      if (hText) {
        const ptr  = Kernel32.GlobalLock(hText);
        const text = readWString(ptr);
        Kernel32.GlobalUnlock(hText);
        if (text.trim()) return { format: 'text', data: text };
      }
    } finally {
      User32.CloseClipboard();
    }
    return null;
  }

  // ── Set clipboard from remote ─────────────────────────────────────────────
  setClipboard(payload: ClipboardPayload): void {
    if (!User32.OpenClipboard(null)) return;
    try {
      User32.EmptyClipboard();

      if (payload.format === 'text') {
        const wstr  = encodeWString(payload.data);
        const hMem  = Kernel32.GlobalAlloc(Kernel32.GMEM_MOVEABLE, wstr.byteLength);
        const ptr   = Kernel32.GlobalLock(hMem);
        writeBuffer(ptr, wstr);
        Kernel32.GlobalUnlock(hMem);
        User32.SetClipboardData(CF_UNICODETEXT, hMem);
      }
      // TODO: HTML and image formats
    } finally {
      User32.CloseClipboard();
    }
    console.log(`[clipboard] Set: ${payload.format} (${payload.data.length} chars)`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readWString(ptrVal: unknown, maxChars = 32768): string {
  const buf  = (Bun as unknown as { FFI: { viewSource(p: unknown, l: number): ArrayBuffer } })
    .FFI.viewSource(ptrVal, maxChars * 2);
  const view = new DataView(buf);
  const chars: number[] = [];
  for (let i = 0; i < maxChars; i++) {
    const code = view.getUint16(i * 2, true);
    if (code === 0) break;
    chars.push(code);
  }
  return String.fromCharCode(...chars);
}

function readCString(ptrVal: unknown, maxBytes = 65536): string {
  const buf  = (Bun as unknown as { FFI: { viewSource(p: unknown, l: number): ArrayBuffer } })
    .FFI.viewSource(ptrVal, maxBytes);
  const bytes = new Uint8Array(buf);
  let end = bytes.indexOf(0);
  if (end < 0) end = maxBytes;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

function encodeWString(s: string): Uint8Array {
  const buf = new Uint8Array((s.length + 1) * 2);
  const dv  = new DataView(buf.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return buf;
}

function writeBuffer(ptrVal: unknown, data: Uint8Array): void {
  const buf = (Bun as unknown as { FFI: { viewSource(p: unknown, l: number): ArrayBuffer } })
    .FFI.viewSource(ptrVal, data.byteLength);
  new Uint8Array(buf).set(data);
}

/** Extract HTML content from Windows HTML clipboard format header */
function parseHtmlClipboard(raw: string): string | null {
  const match = raw.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/);
  return match ? match[1].trim() : null;
}
