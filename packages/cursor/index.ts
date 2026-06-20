import type { CursorMessage } from '../core-protocol';
import { MessageType } from '../core-protocol';
/**
 * Cursor shape capture — Win32 GetCursorInfo + GetIconInfo + GetDIBits
 *
 * Captures the current hardware cursor shape (bitmap + hotspot) and emits
 * a CURSOR protocol message whenever the cursor changes.
 */
import { Gdi32, User32 } from '../win32-compat';

export class CursorCapture {
  private lastCursorHandle: unknown = null;

  /**
   * Poll cursor shape. Returns a CursorMessage if the cursor changed,
   * null otherwise. Call this each frame (it's cheap when unchanged).
   */
  poll(): CursorMessage | null {
    const ci = User32.GetCursorInfo();
    if (!ci || ci.hCursor === this.lastCursorHandle) return null;
    this.lastCursorHandle = ci.hCursor;

    const msg = this._capture(ci.hCursor, ci.ptScreenPos.x, ci.ptScreenPos.y);
    return msg;
  }

  private _capture(hCursor: unknown, screenX: number, screenY: number): CursorMessage | null {
    try {
      const ii = User32.GetIconInfo(hCursor);
      const hotX = ii.xHotspot as number;
      const hotY = ii.yHotspot as number;

      // Get bitmap dimensions from the color bitmap (or mask if color is null)
      const hBmp = ii.hbmColor ?? ii.hbmMask;
      if (!hBmp) return null;

      const bmi = new Gdi32.BITMAPINFO({
        biWidth: 0, // filled by first GetDIBits call
        biHeight: 0,
        biBitCount: 32,
        biCompression: Gdi32.BI_RGB,
      });

      // First call — get dimensions
      const hdcScreen = User32.GetDC(null);
      Gdi32.GetDIBits(hdcScreen, hBmp, 0, 0, null, bmi, Gdi32.DIB_RGB_COLORS);
      const w = Math.abs(bmi.biWidth as number);
      const h = Math.abs(bmi.biHeight as number);
      User32.ReleaseDC(null, hdcScreen);

      if (w === 0 || h === 0) return null;

      // Second call — get pixels
      const hdc2 = User32.GetDC(null);
      const bmi2 = new Gdi32.BITMAPINFO({
        biWidth: w,
        biHeight: -h, // top-down
        biBitCount: 32,
        biCompression: Gdi32.BI_RGB,
      });
      const buf = new Uint8Array(w * h * 4);
      Gdi32.GetDIBits(hdc2, hBmp, 0, h, buf, bmi2, Gdi32.DIB_RGB_COLORS);
      User32.ReleaseDC(null, hdc2);

      // Cleanup icon bitmaps
      Gdi32.DeleteObject(ii.hbmMask);
      if (ii.hbmColor) Gdi32.DeleteObject(ii.hbmColor);

      return {
        type: MessageType.CURSOR,
        x: screenX,
        y: screenY,
        hotX,
        hotY,
        width: w,
        height: h,
        data: buf,
      };
    } catch {
      return null;
    }
  }
}
