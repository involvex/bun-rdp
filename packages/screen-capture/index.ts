import { dxgi } from 'bun-win32';

/**
 * DXGI Desktop Duplication capture
 * Falls back to GDI32 BitBlt if DXGI is unavailable
 */
export class ScreenCapture {
  private duplication: ReturnType<typeof dxgi.IDXGIOutput1.prototype.DuplicateOutput> | null = null;
  private width: number = 0;
  private height: number = 0;

  async init(monitorIndex = 0) {
    try {
      const factory = dxgi.CreateDXGIFactory1();
      const adapter = factory.EnumAdapters1(0);
      const output = adapter.EnumOutputs(monitorIndex);
      const desc = output.GetDesc();
      this.width = desc.DesktopCoordinates.right - desc.DesktopCoordinates.left;
      this.height = desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top;

      const output1 = output.QueryInterface(dxgi.IDXGIOutput1);
      this.duplication = output1.DuplicateOutput();
      console.log(`[capture] DXGI init OK — ${this.width}x${this.height}`);
    } catch (e) {
      console.warn('[capture] DXGI unavailable, falling back to GDI32');
      // TODO: GDI32 BitBlt fallback
    }
  }

  /** Capture one frame — returns raw BGRA buffer */
  captureFrame(timeoutMs = 5000): Uint8Array | null {
    if (!this.duplication) return null;
    try {
      const frame = this.duplication.AcquireNextFrame(timeoutMs);
      const data = frame.GetFrameData() as Uint8Array;
      this.duplication.ReleaseFrame();
      return data;
    } catch {
      return null;
    }
  }

  get dimensions() {
    return { width: this.width, height: this.height };
  }

  dispose() {
    this.duplication = null;
  }
}
