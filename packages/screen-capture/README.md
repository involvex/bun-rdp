# screen-capture

Dual-backend screen capture — DXGI first, GDI32 as fallback.

| Backend | Used when | Notes |
|---|---|---|
| **DXGI Desktop Duplication** | Windows 8+, GPU | Zero-copy GPU capture, no cursor baked in |
| **GDI32 BitBlt** | VM / RDP / no GPU | Universal; cursor composited via DrawIconEx |

## Output

```ts
interface CaptureFrame {
  data: Uint8Array; // BGRA pixels, top-down
  width: number;
  height: number;
  timestamp: number;
}
```

## Usage

```ts
const cap = new ScreenCapture();
const backend = cap.init(0); // 'dxgi' | 'gdi32'
const frame = cap.captureFrame(16); // 16ms timeout
cap.dispose();
```

## DXGI flow
1. `IDXGIOutput1::DuplicateOutput` with a D3D11 device
2. `AcquireNextFrame` (GPU-side) → `CopyResource` to staging texture
3. `Map(D3D11_MAP_READ)` → row-by-row CPU copy (respecting RowPitch)
4. `Unmap` → `ReleaseFrame`

## GDI32 flow
1. `CreateCompatibleDC` + `CreateCompatibleBitmap`
2. `BitBlt(SRCCOPY)` screen → mem DC
3. `DrawIconEx` composites hardware cursor
4. `GetDIBits` extracts top-down BGRA
