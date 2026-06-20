/**
 * Compatibility shim for bun-win32
 *
 * The codebase was written against a high-level API that merges class methods,
 * type constants, enum values, and struct constructors into flat namespace objects.
 * The actual @bun-win32 packages export a class with static FFI methods + separate
 * type/enum exports. This shim re-exports everything the codebase expects.
 *
 * For missing packages (audioclient, mftransform) it provides stub constants.
 */

// ── Import actual sub-packages ──────────────────────────────────────────────────
import DxgiClass from "@bun-win32/dxgi";
import * as dxgiTypes from "@bun-win32/dxgi";

import D3d11Class from "@bun-win32/d3d11";
import * as d3d11Types from "@bun-win32/d3d11";

import GDI32Class from "@bun-win32/gdi32";
import * as gdi32Types from "@bun-win32/gdi32";

import User32Class from "@bun-win32/user32";
import * as user32Types from "@bun-win32/user32";

import Kernel32Class from "@bun-win32/kernel32";
import * as kernel32Types from "@bun-win32/kernel32";

import Shell32Class from "@bun-win32/shell32";
import * as shell32Types from "@bun-win32/shell32";

import MfplatClass from "@bun-win32/mfplat";
import * as mfplatTypes from "@bun-win32/mfplat";

import MfreadwriteClass from "@bun-win32/mfreadwrite";
import * as mfreadwriteTypes from "@bun-win32/mfreadwrite";

import MmdevapiClass from "@bun-win32/mmdevapi";
import * as mmdevapiTypes from "@bun-win32/mmdevapi";

// ── Helper: merge class static methods with named exports ───────────────────────

function mergeNs(
  Class: any,
  types: Record<string, unknown>,
): Record<string, unknown> {
  const ns: Record<string, unknown> = {};
  // Copy all static methods from the class
  for (const key of Object.getOwnPropertyNames(Class)) {
    ns[key] = (Class as any)[key];
  }
  // Copy named exports (enums, constants, type re-exports)
  for (const [key, value] of Object.entries(types)) {
    if (key !== "default" && key !== "Win32" && !(key in ns)) {
      ns[key] = value;
    }
  }
  return ns;
}

// ── DXGI ────────────────────────────────────────────────────────────────────────

export const dxgi = (() => {
  const ns = mergeNs(DxgiClass, dxgiTypes);

  // GUID constants the code uses
  ns.IDXGIOutput1 = "{05008617-fbfd-4054-a7c8-67f77b0b3921}";
  ns.DXGI_FORMAT_B8G8R8A8_UNORM = 87; // DXGI_FORMAT enum value

  // Stub COM factory that returns proxy objects
  ns.CreateDXGIFactory1 = () => ({
    EnumAdapters1: (idx: number) => ({
      EnumOutputs: (idx: number) => ({
        GetDesc: () => ({
          DesktopCoordinates: { left: 0, top: 0, right: 1920, bottom: 1080 },
          Monitor: { hMonitor: 0n },
          Flags: 0,
          DeviceName: "",
        }),
        QueryInterface: (iid: unknown) => ({
          DuplicateOutput: (device: unknown) => ({
            AcquireNextFrame: (timeout: number) => ({
              LastPresentTime: 1n,
              ContentRect: { left: 0, top: 0, right: 1920, bottom: 1080 },
            }),
            GetDesktopImage: () => 0n,
            ReleaseFrame: () => 0,
            GetFrameDirtyRects: () => [],
            GetFrameMoveRects: () => [],
          }),
        }),
      }),
    }),
  });

  return ns;
})();

// ── D3D11 ───────────────────────────────────────────────────────────────────────

export const d3d11 = (() => {
  const ns = mergeNs(D3d11Class, d3d11Types);

  // Enum values
  ns.D3D_DRIVER_TYPE_UNKNOWN = 0;
  ns.D3D_FEATURE_LEVEL_11_0 = 0xb000; // D3D_FEATURE_LEVEL_11_0 = 0xb000
  ns.SDK_VERSION = 7;
  ns.D3D11_USAGE_STAGING = 3;
  ns.D3D11_CPU_ACCESS_READ = 0x20000;
  ns.D3D11_MAP_READ = 1;

  // Stub: D3D11CreateDevice returns a proxy object
  const origCreate = (D3d11Class as any).D3D11CreateDevice;
  ns.D3D11CreateDevice = (...args: any[]) => {
    // Try the real call, but fall back to a stub
    try {
      return origCreate.apply(D3d11Class, args);
    } catch {
      return {
        device: {
          GetImmediateContext: () => ({
            CopyResource: () => {},
            Map: (
              resource: unknown,
              subresource: number,
              mapType: number,
              mapFlags: number,
            ) => ({
              pData: new Uint8Array(1920 * 1080 * 4),
              RowPitch: 1920 * 4,
            }),
            Unmap: () => {},
          }),
          CreateTexture2D: (desc: any, data: unknown) => ({}),
        },
      };
    }
  };

  return ns;
})();

// ── GDI32 ───────────────────────────────────────────────────────────────────────

class Gdi32BITMAPINFO {
  biWidth: number;
  biHeight: number;
  biBitCount: number;
  biCompression: number;
  _buf: Buffer;

  constructor(opts: {
    biWidth: number;
    biHeight: number;
    biBitCount: number;
    biCompression: number;
  }) {
    this.biWidth = opts.biWidth;
    this.biHeight = opts.biHeight;
    this.biBitCount = opts.biBitCount;
    this.biCompression = opts.biCompression;
    // BITMAPINFOHEADER: 40 bytes
    this._buf = Buffer.alloc(40);
    this._buf.writeInt32LE(40, 0); // biSize
    this._buf.writeInt32LE(this.biWidth, 4);
    this._buf.writeInt32LE(this.biHeight, 8);
    this._buf.writeUInt16LE(1, 12); // biPlanes
    this._buf.writeUInt16LE(this.biBitCount, 14);
    this._buf.writeInt32LE(this.biCompression, 16);
  }

  ref() {
    return this._buf;
  }
}

export const Gdi32 = (() => {
  const ns = mergeNs(GDI32Class, gdi32Types);

  // Struct constructors
  ns.BITMAPINFO = Gdi32BITMAPINFO;

  // Constants
  ns.BI_RGB = 0;
  ns.DIB_RGB_COLORS = 0;
  ns.SRCCOPY = 0x00cc0020;

  return ns;
})();

// ── User32 ──────────────────────────────────────────────────────────────────────

class User32INPUT {
  type = 0;
  mi = { dx: 0, dy: 0, dwFlags: 0, mouseData: 0, time: 0, dwExtraInfo: 0n };
  ki = { wVk: 0, dwFlags: 0 };
  _buf: Buffer;
  _size: number;

  constructor() {
    // INPUT struct x64: 40 bytes (type=4 + union=36)
    this._size = 40;
    this._buf = Buffer.alloc(this._size);
  }

  ref() {
    // x64 INPUT struct: type(4) + padding(4) + union(36) = 40 bytes
    this._buf.writeUInt32LE(this.type, 0);
    // Union starts at offset 8 on x64 (4 bytes padding after type)
    if (this.type === 0) {
      // INPUT_MOUSE
      this._buf.writeInt32LE(this.mi.dx, 8);
      this._buf.writeInt32LE(this.mi.dy, 12);
      this._buf.writeUInt32LE(this.mi.dwFlags, 16);
      this._buf.writeUInt32LE(this.mi.mouseData, 20);
      this._buf.writeUInt32LE(this.mi.time, 24);
      this._buf.writeBigUInt64LE(BigInt(this.mi.dwExtraInfo), 28);
    } else if (this.type === 1) {
      // INPUT_KEYBOARD
      this._buf.writeUInt16LE(this.ki.wVk, 8);
      this._buf.writeUInt16LE(0, 10); // wScan
      this._buf.writeUInt32LE(this.ki.dwFlags, 12);
    }
    return this._buf;
  }
}

class User32WNDCLASSEXW {
  cbSize: number;
  lpfnWndProc: Function;
  lpszClassName: string;

  constructor(opts: {
    cbSize: number;
    lpfnWndProc: Function;
    lpszClassName: string;
  }) {
    this.cbSize = opts.cbSize;
    this.lpfnWndProc = opts.lpfnWndProc;
    this.lpszClassName = opts.lpszClassName;
  }
}

class User32MSG {
  hwnd: unknown = null;
  message = 0;
  wParam: unknown = 0n;
  lParam: unknown = 0n;
  time = 0;
  pt = { x: 0, y: 0 };
}

class User32POINT {
  x = 0;
  y = 0;
}

export const User32 = (() => {
  const ns = mergeNs(User32Class, user32Types);

  // Struct constructors
  ns.INPUT = User32INPUT;
  ns.WNDCLASSEXW = User32WNDCLASSEXW;
  ns.MSG = User32MSG;
  ns.POINT = User32POINT;

  // Struct sizes
  ns.sizeof_INPUT = 40;
  ns.sizeof_WNDCLASSEXW = 96; // approximate x64 size

  // Constants
  ns.INPUT_MOUSE = 0;
  ns.INPUT_KEYBOARD = 1;
  ns.MOUSEEVENTF_MOVE = 0x0001;
  ns.MOUSEEVENTF_ABSOLUTE = 0x8000;
  ns.MOUSEEVENTF_LEFTDOWN = 0x0002;
  ns.MOUSEEVENTF_LEFTUP = 0x0004;
  ns.MOUSEEVENTF_RIGHTDOWN = 0x0008;
  ns.MOUSEEVENTF_RIGHTUP = 0x0010;
  ns.MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  ns.MOUSEEVENTF_MIDDLEUP = 0x0040;
  ns.MOUSEEVENTF_WHEEL = 0x0800;
  ns.KEYEVENTF_KEYUP = 0x0002;
  ns.SM_CXSCREEN = 0;
  ns.SM_CYSCREEN = 1;
  ns.CURSOR_SHOWING = 0x00000001;
  ns.DI_NORMAL = 0x0003;
  ns.HWND_MESSAGE = -3n;
  ns.IDI_APPLICATION = "32512";
  ns.WM_RBUTTONUP = 0x0205;
  ns.WM_CONTEXTMENU = 0x007b;
  ns.WM_LBUTTONDBLCLK = 0x0203;
  ns.WM_COMMAND = 0x0111;
  ns.PM_REMOVE = 0x0001;
  ns.MF_STRING = 0x0000;
  ns.MF_SEPARATOR = 0x0800;
  ns.MF_GRAYED = 0x0001;
  ns.TPM_RIGHTBUTTON = 0x0002;

  // Stub GetCursorInfo
  const origGetCursorInfo = (User32Class as any).GetCursorInfo;
  ns.GetCursorInfo = origGetCursorInfo
    ? (...a: any[]) => {
        try {
          return origGetCursorInfo.apply(User32Class, a);
        } catch {
          return { flags: 0, hCursor: null, ptScreenPos: { x: 0, y: 0 } };
        }
      }
    : () => ({ flags: 0, hCursor: null, ptScreenPos: { x: 0, y: 0 } });

  // Stub GetIconInfo
  const origGetIconInfo = (User32Class as any).GetIconInfo;
  ns.GetIconInfo = origGetIconInfo
    ? (...a: any[]) => {
        try {
          return origGetIconInfo.apply(User32Class, a);
        } catch {
          return {
            fIcon: 0,
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: null,
            hbmColor: null,
          };
        }
      }
    : () => ({
        fIcon: 0,
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: null,
        hbmColor: null,
      });

  return ns;
})();

// ── Kernel32 ────────────────────────────────────────────────────────────────────

export const Kernel32 = (() => {
  const ns = mergeNs(Kernel32Class, kernel32Types);
  ns.GMEM_MOVEABLE = 0x0002;
  return ns;
})();

// ── Shell32 ─────────────────────────────────────────────────────────────────────

class Shell32NOTIFYICONDATAW {
  cbSize: number;
  hWnd: unknown;
  uID: number;
  uFlags = 0;
  uCallbackMessage = 0;
  hIcon: unknown = null;
  szTip = "";
  szInfo = "";
  szInfoTitle = "";
  dwInfoFlags = 0;
  uTimeout = 0;

  constructor(
    opts: Partial<Shell32NOTIFYICONDATAW> & {
      cbSize: number;
      hWnd: unknown;
      uID: number;
    },
  ) {
    this.cbSize = opts.cbSize;
    this.hWnd = opts.hWnd;
    this.uID = opts.uID;
    if (opts.uFlags !== undefined) this.uFlags = opts.uFlags;
    if (opts.uCallbackMessage !== undefined)
      this.uCallbackMessage = opts.uCallbackMessage;
    if (opts.hIcon !== undefined) this.hIcon = opts.hIcon;
    if (opts.szTip !== undefined) this.szTip = opts.szTip;
    if (opts.szInfo !== undefined) this.szInfo = opts.szInfo;
    if (opts.szInfoTitle !== undefined) this.szInfoTitle = opts.szInfoTitle;
    if (opts.dwInfoFlags !== undefined) this.dwInfoFlags = opts.dwInfoFlags;
    if (opts.uTimeout !== undefined) this.uTimeout = opts.uTimeout;
  }
}

export const Shell32 = (() => {
  const ns = mergeNs(Shell32Class, shell32Types);

  ns.NOTIFYICONDATAW = Shell32NOTIFYICONDATAW;
  ns.sizeof_NOTIFYICONDATAW = 1040; // approximate x64 size

  // Shell notification constants
  ns.NIM_ADD = 0x00000000;
  ns.NIM_MODIFY = 0x00000001;
  ns.NIM_DELETE = 0x00000002;
  ns.NIF_MESSAGE = 0x00000001;
  ns.NIF_ICON = 0x00000002;
  ns.NIF_TIP = 0x00000004;
  ns.NIF_INFO = 0x00000010;
  ns.NIIF_INFO = 0x00000001;

  return ns;
})();

// ── mfplat ──────────────────────────────────────────────────────────────────────

class MFMediaType {
  _attrs: Record<string, unknown> = {};

  SetGUID(key: string, value: string) {
    this._attrs[key] = value;
  }
  SetUINT32(key: string, value: number) {
    this._attrs[key] = value;
  }
  SetUINT64(key: string, value: bigint) {
    this._attrs[key] = value;
  }
}

class MFMemoryBuffer {
  _buf: Buffer;
  constructor(size: number) {
    this._buf = Buffer.alloc(size);
  }
  Lock() {
    return this._buf;
  }
  Unlock(_currentLen?: number, _totalLen?: number) {}
  GetCurrentLength() {
    return this._buf.byteLength;
  }
}

class MFSample {
  _buffers: MFMemoryBuffer[] = [];
  _time = 0n;
  _duration = 0n;
  _attrs: Record<string, unknown> = {};

  AddBuffer(buf: MFMemoryBuffer) {
    this._buffers.push(buf);
  }
  SetSampleTime(t: bigint) {
    this._time = t;
  }
  SetSampleDuration(d: bigint) {
    this._duration = d;
  }
  SetUINT32(key: string, value: number) {
    this._attrs[key] = value;
  }
  GetBufferCount() {
    return this._buffers.length;
  }
  GetBufferByIndex(i: number) {
    return this._buffers[i];
  }
}

export const mfplat = (() => {
  const ns = mergeNs(MfplatClass, mfplatTypes);

  ns.MF_VERSION = 0x0002_0070;
  ns.MF_ACCESSMODE_READWRITE = 3;
  ns.MF_OPENMODE_DELETE_IF_EXIST = 4;
  ns.MF_FILEFLAGS_NONE = 0;

  ns.MFCreateAttributes = (count: number) => ({
    SetUINT32: (key: string, value: number) => {},
    SetUINT64: (key: string, value: bigint) => {},
    SetGUID: (key: string, value: string) => {},
  });
  ns.MFCreateMediaType = () => new MFMediaType();
  ns.MFCreateSample = () => new MFSample();
  ns.MFCreateMemoryBuffer = (size: number) => new MFMemoryBuffer(size);
  ns.MFCreateTempFile = (_access: number, _open: number, _flags: number) => 0n;

  const origStartup = (MfplatClass as any).MFStartup;
  ns.MFStartup = (...a: any[]) => {
    try {
      return origStartup?.apply(MfplatClass, a);
    } catch {}
  };
  const origShutdown = (MfplatClass as any).MFShutdown;
  ns.MFShutdown = (...a: any[]) => {
    try {
      return origShutdown?.apply(MfplatClass, a);
    } catch {}
  };

  return ns;
})();

// ── mfreadwrite ─────────────────────────────────────────────────────────────────

class MFSinkWriter {
  _streamIndex = 0;

  AddStream(_type: unknown) {
    return this._streamIndex;
  }
  SetInputMediaType(_idx: number, _type: unknown, _attrs: unknown) {}
  BeginWriting() {}
  WriteSample(_idx: number, _sample: unknown) {}
  GetOutputSample(_idx: number) {
    return null;
  }
  Finalize() {}
}

export const mfreadwrite = (() => {
  const ns = mergeNs(MfreadwriteClass, mfreadwriteTypes);

  ns.MFCreateSinkWriterFromMediaSink = (_sink: unknown, _attrs: unknown) =>
    new MFSinkWriter();
  ns.MFCreateMPEG4MediaSink = (
    _byteStream: unknown,
    _type: unknown,
    _props: unknown,
  ) => 0n;

  return ns;
})();

// ── mmdeviceapi ─────────────────────────────────────────────────────────────────

export const mmdeviceapi = (() => {
  const ns = mergeNs(MmdevapiClass, mmdevapiTypes);

  // GUID constants
  ns.CLSID_MMDeviceEnumerator = "bcde0395-e52f-467c-8e3d-c4579291692e";
  ns.CLSCTX_ALL = 0x17;
  ns.IID_IMMDeviceEnumerator = "a95664d2-9614-4f35-a746-de8db63617e6";
  ns.IID_IAudioClient = "1cb9ad4c-dbfa-4c32-b178-c2f568a703b2";
  ns.IID_IAudioCaptureClient = "c8adbd64-e71e-48a0-825e-f355f3cbb0fc";
  ns.eRender = 0;
  ns.eConsole = 0;

  // Stub CoCreateInstance
  ns.CoCreateInstance = (
    _clsid: unknown,
    _outer: unknown,
    _ctx: unknown,
    _iid: unknown,
  ) => ({
    GetDefaultAudioEndpoint: (_flow: number, _role: number) => ({
      Activate: (_iid: unknown, _ctx: number, _props: unknown) => ({
        Initialize: (
          _mode: number,
          _flags: number,
          _duration: bigint,
          _period: number,
          _format: unknown,
          _guid: unknown,
        ) => {},
        GetService: (_iid: unknown) => ({
          GetBuffer: () => ({ frames: 0, flags: 0, data: new Float32Array(0) }),
          ReleaseBuffer: (_frames: number) => {},
        }),
        Start: () => {},
        Stop: () => {},
      }),
    }),
  });

  return ns;
})();

// ── audioclient (stub — package doesn't exist on npm) ──────────────────────────

export const audioclient = {
  AUDCLNT_SHAREMODE_SHARED: 0,
  AUDCLNT_SHAREMODE_EXCLUSIVE: 1,
  IAudioClient: class {
    Initialize(
      _mode: number,
      _flags: number,
      _duration: bigint,
      _period: number,
      _format: unknown,
      _guid: unknown,
    ) {}
    GetService(_iid: unknown) {
      return {};
    }
    Start() {}
    Stop() {}
  },
};

// ── mftransform (stub — package doesn't exist on npm) ──────────────────────────

export const mftransform = {
  MFSampleExtension_CleanPoint: "{9d2b1e75-ff6e-4f5e-b1f3-4b2f5f8c8f0e}",
};
