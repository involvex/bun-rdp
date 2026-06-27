/**
 * System-tray icon — bun-win32 Shell_NotifyIcon
 *
 * Shows a tray icon with a context menu:
 *   • Open web-ui    — opens browser to https://localhost:<PORT>
 *   • Copy link      — copies share link to clipboard
 *   • Status         — shows connection count balloon
 *   • Stop server    — graceful shutdown
 *
 * Runs in the same process as the server (no separate window).
 */
import { Kernel32, Shell32, User32 } from "../packages/win32-compat";

const WM_APP_TRAY = 0x8001; // custom WM message for tray callbacks
const ID_TRAY = 1;

// Menu item IDs
const MENU_OPEN = 1001;
const MENU_COPY = 1002;
const MENU_STATUS = 1003;
const MENU_STOP = 1004;

export interface TrayConfig {
  port: number;
  getConnCount: () => number;
  getShareLink: () => string;
  onStop: () => void;
}

export class TrayIcon {
  private hwnd: unknown = null;
  private hIcon: unknown = null;
  private cfg: TrayConfig;
  private running = false;

  constructor(cfg: TrayConfig) {
    this.cfg = cfg;
  }

  init(): void {
    // Create a hidden message-only window to receive tray messages
    const wc = new User32.WNDCLASSEXW({
      cbSize: User32.sizeof_WNDCLASSEXW,
      lpfnWndProc: this._wndProc.bind(this),
      lpszClassName: "bun-rdp-tray",
    });
    User32.RegisterClassExW(wc.ref());

    this.hwnd = User32.CreateWindowExW(
      0,
      "bun-rdp-tray",
      "bun-rdp",
      0,
      0,
      0,
      0,
      0,
      User32.HWND_MESSAGE,
      null,
      null,
      null,
    );

    // Load a default application icon (IDI_APPLICATION)
    this.hIcon = User32.LoadIconW(null, User32.IDI_APPLICATION);

    // Register tray icon
    const nid = new Shell32.NOTIFYICONDATAW({
      cbSize: Shell32.sizeof_NOTIFYICONDATAW,
      hWnd: this.hwnd,
      uID: ID_TRAY,
      uFlags: Shell32.NIF_ICON | Shell32.NIF_MESSAGE | Shell32.NIF_TIP,
      uCallbackMessage: WM_APP_TRAY,
      hIcon: this.hIcon,
      szTip: `bun-rdp — port ${this.cfg.port}`,
    });
    Shell32.Shell_NotifyIconW(Shell32.NIM_ADD, nid);

    this.running = true;
    this._messageLoop();
    console.log("[tray] System-tray icon active");
  }

  private _messageLoop(): void {
    const msg = new User32.MSG();
    const tick = () => {
      if (!this.running) return;
      while (User32.PeekMessageW(msg, null, 0, 0, User32.PM_REMOVE)) {
        User32.TranslateMessage(msg);
        User32.DispatchMessageW(msg);
      }
      setTimeout(tick, 50);
    };
    tick();
  }

  private _wndProc(
    hwnd: unknown,
    msg: number,
    wp: unknown,
    lp: unknown,
  ): number {
    if (msg === WM_APP_TRAY) {
      const event = lp as number;
      if (event === User32.WM_RBUTTONUP || event === User32.WM_CONTEXTMENU) {
        this._showMenu();
        return 0;
      }
      if (event === User32.WM_LBUTTONDBLCLK) {
        this._openBrowser();
        return 0;
      }
    }
    if (msg === User32.WM_COMMAND) {
      const item = (wp as number) & 0xffff;
      this._onMenu(item);
      return 0;
    }
    return User32.DefWindowProcW(hwnd, msg, wp, lp) as number;
  }

  private _showMenu(): void {
    const count = this.cfg.getConnCount();
    const hMenu = User32.CreatePopupMenu();
    User32.AppendMenuW(hMenu, User32.MF_STRING, MENU_OPEN, "🌐  Open web-ui");
    User32.AppendMenuW(
      hMenu,
      User32.MF_STRING,
      MENU_COPY,
      "🔗  Copy share link",
    );
    User32.AppendMenuW(hMenu, User32.MF_SEPARATOR, 0, null);
    User32.AppendMenuW(
      hMenu,
      User32.MF_STRING | User32.MF_GRAYED,
      MENU_STATUS,
      `👥  ${count} client${count !== 1 ? "s" : ""} connected`,
    );
    User32.AppendMenuW(hMenu, User32.MF_SEPARATOR, 0, null);
    User32.AppendMenuW(hMenu, User32.MF_STRING, MENU_STOP, "⏹  Stop server");

    const pt = new User32.POINT();
    User32.GetCursorPos(pt);
    User32.SetForegroundWindow(this.hwnd);
    User32.TrackPopupMenu(
      hMenu,
      User32.TPM_RIGHTBUTTON,
      pt.x,
      pt.y,
      0,
      this.hwnd,
      null,
    );
    User32.DestroyMenu(hMenu);
  }

  private _onMenu(item: number): void {
    switch (item) {
      case MENU_OPEN:
        this._openBrowser();
        break;
      case MENU_COPY:
        this._copyLink();
        break;
      case MENU_STOP:
        this._stop();
        break;
    }
  }

  private _openBrowser(): void {
    const url = `https://localhost:${this.cfg.port}`;
    Shell32.ShellExecuteW(null, "open", url, null, null, 1);
  }

  private _copyLink(): void {
    const link = this.cfg.getShareLink();
    if (User32.OpenClipboard(null)) {
      User32.EmptyClipboard();
      const wstr = encodeWString(link);
      const hMem = Kernel32.GlobalAlloc(
        Kernel32.GMEM_MOVEABLE,
        wstr.byteLength,
      );
      const ptr = Kernel32.GlobalLock(hMem);
      new Uint8Array(
        (
          Bun as unknown as {
            FFI: { viewSource(p: unknown, l: number): ArrayBuffer };
          }
        ).FFI.viewSource(ptr, wstr.byteLength),
      ).set(wstr);
      Kernel32.GlobalUnlock(hMem);
      User32.SetClipboardData(13 /* CF_UNICODETEXT */, hMem);
      User32.CloseClipboard();
      this._balloon("Link copied!", "Share link copied to clipboard.");
    }
  }

  private _balloon(title: string, text: string): void {
    const nid = new Shell32.NOTIFYICONDATAW({
      cbSize: Shell32.sizeof_NOTIFYICONDATAW,
      hWnd: this.hwnd,
      uID: ID_TRAY,
      uFlags: Shell32.NIF_INFO,
      szInfoTitle: title,
      szInfo: text,
      dwInfoFlags: Shell32.NIIF_INFO,
      uTimeout: 3000,
    });
    Shell32.Shell_NotifyIconW(Shell32.NIM_MODIFY, nid);
  }

  private _stop(): void {
    this.dispose();
    this.cfg.onStop();
  }

  dispose(): void {
    if (!this.running) return;
    this.running = false;
    const nid = new Shell32.NOTIFYICONDATAW({
      cbSize: Shell32.sizeof_NOTIFYICONDATAW,
      hWnd: this.hwnd,
      uID: ID_TRAY,
    });
    Shell32.Shell_NotifyIconW(Shell32.NIM_DELETE, nid);
    console.log("[tray] Removed");
  }
}

function encodeWString(s: string): Uint8Array {
  const buf = new Uint8Array((s.length + 1) * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return buf;
}
