import { d3d11, dxgi, Gdi32, User32 } from '../win32-compat';

export interface CaptureFrame {
  data: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
}

// DXGI Desktop Duplication
class DxgiCapture {
  private duplication: any = null;
  private device: any = null;
  width = 0;
  height = 0;

  init(monitorIndex = 0): boolean {
    try {
      const factory = dxgi.CreateDXGIFactory1();
      const adapter = factory.EnumAdapters1(0);
      const output = adapter.EnumOutputs(monitorIndex);
      const desc = output.GetDesc();
      this.width = desc.DesktopCoordinates.right - desc.DesktopCoordinates.left;
      this.height = desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top;
      const result = d3d11.D3D11CreateDevice(
        adapter,
        d3d11.D3D_DRIVER_TYPE_UNKNOWN,
        null,
        0,
        [d3d11.D3D_FEATURE_LEVEL_11_0],
        d3d11.SDK_VERSION
      );
      this.device = result.device;
      const output1 = output.QueryInterface(dxgi.IDXGIOutput1);
      this.duplication = output1.DuplicateOutput(this.device);
      console.log(`[dxgi] ${this.width}x${this.height}`);
      return true;
    } catch {
      return false;
    }
  }

  capture(timeoutMs = 16): CaptureFrame | null {
    if (!this.duplication) return null;
    try {
      const fi = this.duplication.AcquireNextFrame(timeoutMs);
      if (!fi || fi.LastPresentTime === 0n) {
        this.duplication.ReleaseFrame();
        return null;
      }
      const img = this.duplication.GetDesktopImage();
      const ctx = this.device.GetImmediateContext();
      const staging = this.device.CreateTexture2D(
        {
          Width: this.width,
          Height: this.height,
          MipLevels: 1,
          ArraySize: 1,
          Format: dxgi.DXGI_FORMAT_B8G8R8A8_UNORM,
          SampleDesc: { Count: 1, Quality: 0 },
          Usage: d3d11.D3D11_USAGE_STAGING,
          BindFlags: 0,
          CPUAccessFlags: d3d11.D3D11_CPU_ACCESS_READ,
          MiscFlags: 0,
        },
        null
      );
      ctx.CopyResource(staging, img);
      const mapped = ctx.Map(staging, 0, d3d11.D3D11_MAP_READ, 0);
      const out = new Uint8Array(this.width * this.height * 4);
      for (let row = 0; row < this.height; row++) {
        const srcOff = row * mapped.RowPitch;
        out.set(mapped.pData.subarray(srcOff, srcOff + this.width * 4), row * this.width * 4);
      }
      ctx.Unmap(staging, 0);
      this.duplication.ReleaseFrame();
      return {
        data: out,
        width: this.width,
        height: this.height,
        timestamp: Date.now(),
      };
    } catch {
      return null;
    }
  }

  dispose() {
    this.duplication = null;
    this.device = null;
  }
}

// GDI32 BitBlt fallback
class Gdi32Capture {
  width = 0;
  height = 0;
  private hdcScreen: any = null;
  private hdcMem: any = null;
  private hBitmap: any = null;

  init(): boolean {
    try {
      this.width = User32.GetSystemMetrics(User32.SM_CXSCREEN);
      this.height = User32.GetSystemMetrics(User32.SM_CYSCREEN);
      this.hdcScreen = User32.GetDC(null);
      this.hdcMem = Gdi32.CreateCompatibleDC(this.hdcScreen);
      this.hBitmap = Gdi32.CreateCompatibleBitmap(this.hdcScreen, this.width, this.height);
      Gdi32.SelectObject(this.hdcMem, this.hBitmap);
      console.log(`[gdi32] ${this.width}x${this.height}`);
      return true;
    } catch {
      return false;
    }
  }

  capture(): CaptureFrame | null {
    if (!this.hdcScreen) return null;
    try {
      Gdi32.BitBlt(this.hdcMem, 0, 0, this.width, this.height, this.hdcScreen, 0, 0, Gdi32.SRCCOPY);
      const ci = User32.GetCursorInfo();
      if (ci.flags === User32.CURSOR_SHOWING)
        User32.DrawIconEx(
          this.hdcMem,
          ci.ptScreenPos.x,
          ci.ptScreenPos.y,
          ci.hCursor,
          0,
          0,
          0,
          null,
          User32.DI_NORMAL
        );
      const bmi = new Gdi32.BITMAPINFO({
        biWidth: this.width,
        biHeight: -this.height,
        biBitCount: 32,
        biCompression: Gdi32.BI_RGB,
      });
      const buf = new Uint8Array(this.width * this.height * 4);
      Gdi32.GetDIBits(this.hdcMem, this.hBitmap, 0, this.height, buf, bmi, Gdi32.DIB_RGB_COLORS);
      return {
        data: buf,
        width: this.width,
        height: this.height,
        timestamp: Date.now(),
      };
    } catch {
      return null;
    }
  }

  dispose() {
    if (this.hBitmap) Gdi32.DeleteObject(this.hBitmap);
    if (this.hdcMem) Gdi32.DeleteDC(this.hdcMem);
    if (this.hdcScreen) User32.ReleaseDC(null, this.hdcScreen);
  }
}

// Public API
export type CaptureBackend = 'dxgi' | 'gdi32';

export class ScreenCapture {
  private backend: DxgiCapture | Gdi32Capture | null = null;
  private _backendName: CaptureBackend = 'dxgi';
  width = 0;
  height = 0;

  init(monitorIndex = 0): CaptureBackend {
    const d = new DxgiCapture();
    if (d.init(monitorIndex)) {
      this.backend = d;
      this._backendName = 'dxgi';
      this.width = d.width;
      this.height = d.height;
    } else {
      const g = new Gdi32Capture();
      if (!g.init()) throw new Error('[capture] Both backends failed');
      this.backend = g;
      this._backendName = 'gdi32';
      this.width = g.width;
      this.height = g.height;
    }
    return this._backendName;
  }

  get backendName(): CaptureBackend {
    return this._backendName;
  }
  get dimensions() {
    return { width: this.width, height: this.height };
  }

  captureFrame(timeoutMs = 16): CaptureFrame | null {
    if (this.backend instanceof DxgiCapture) return this.backend.capture(timeoutMs);
    if (this.backend instanceof Gdi32Capture) return this.backend.capture();
    return null;
  }

  dispose() {
    this.backend?.dispose();
    this.backend = null;
  }
}
