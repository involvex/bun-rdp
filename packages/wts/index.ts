/**
 * WTSAPI32 - Windows Terminal Services API
 * Real FFI bindings via bun:ffi -> WTSAPI32.DLL
 * Ref: https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/
 */
import { FFIType, dlopen } from 'bun:ffi';

export const WTS_CONNECTSTATE_CLASS = {
  WTSActive: 0,
  WTSConnected: 1,
  WTSConnectQuery: 2,
  WTSShadow: 3,
  WTSDisconnected: 4,
  WTSIdle: 5,
  WTSListen: 6,
  WTSReset: 7,
  WTSDown: 8,
  WTSInit: 9,
} as const;
export type WtsConnectState = keyof typeof WTS_CONNECTSTATE_CLASS;

export const WTS_INFO_CLASS = {
  WTSInitialProgram: 0,
  WTSApplicationName: 1,
  WTSWorkingDirectory: 2,
  WTSOEMId: 3,
  WTSSessionId: 4,
  WTSUserName: 5,
  WTSWinStationName: 6,
  WTSDomainName: 7,
  WTSConnectState: 8,
  WTSClientBuildNumber: 9,
  WTSClientName: 10,
  WTSClientDirectory: 11,
  WTSClientProductId: 12,
  WTSClientHardwareId: 13,
  WTSClientAddress: 14,
  WTSClientDisplay: 15,
  WTSClientProtocolType: 16,
  WTSIdleTime: 17,
  WTSLogonTime: 18,
  WTSIncomingBytes: 19,
  WTSOutgoingBytes: 20,
  WTSIncomingFrames: 21,
  WTSOutgoingFrames: 22,
  WTSClientInfo: 23,
  WTSSessionInfo: 24,
} as const;
export type WtsInfoClass = (typeof WTS_INFO_CLASS)[keyof typeof WTS_INFO_CLASS];

let _lib: ReturnType<typeof dlopen> | null = null;

function lib() {
  if (_lib) return _lib;
  _lib = dlopen('wtsapi32', {
    WTSEnumerateSessionsW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
    WTSFreeMemory: { args: [FFIType.ptr], returns: FFIType.void },
    WTSQuerySessionInformationW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
    WTSSendMessageW: {
      args: [
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
        FFIType.u32,
        FFIType.u32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.bool,
      ],
      returns: FFIType.bool,
    },
    WTSDisconnectSession: {
      args: [FFIType.ptr, FFIType.u32, FFIType.bool],
      returns: FFIType.bool,
    },
    WTSLogoffSession: {
      args: [FFIType.ptr, FFIType.u32, FFIType.bool],
      returns: FFIType.bool,
    },
  });
  return _lib;
}

const WTS_CURRENT_SERVER = null;
type BunFFI = { viewSource(ptr: bigint, len: number): ArrayBuffer; ptr(addr: bigint): unknown };
const ffi = () => (Bun as unknown as { FFI: BunFFI }).FFI;

function readWString(buf: ArrayBuffer, maxBytes = 512): string {
  const view = new DataView(buf);
  const chars: number[] = [];
  for (let i = 0; i + 1 < Math.min(buf.byteLength, maxBytes); i += 2) {
    const code = view.getUint16(i, true);
    if (code === 0) break;
    chars.push(code);
  }
  return String.fromCharCode(...chars);
}

function encodeWStr(s: string): Buffer {
  const buf = Buffer.alloc((s.length + 1) * 2);
  for (let i = 0; i < s.length; i++) buf.writeUInt16LE(s.charCodeAt(i), i * 2);
  return buf;
}

export interface WtsSession {
  sessionId: number;
  winStationName: string;
  state: WtsConnectState;
}

export interface WtsClientDisplay {
  HorizontalResolution: number;
  VerticalResolution: number;
  ColorDepth: number;
}

/**
 * List all local sessions.
 * WTS_SESSION_INFOW layout (x64): [+0 DWORD id][+4 pad][+8 LPWSTR name][+16 DWORD state][+20 pad] = 24 bytes
 */
export function enumerateSessions(): WtsSession[] {
  const ppSess = Buffer.alloc(8);
  const pCount = Buffer.alloc(4);
  if (!lib().symbols.WTSEnumerateSessionsW(WTS_CURRENT_SERVER, 0, 1, ppSess, pCount))
    throw new Error('WTSEnumerateSessionsW failed');
  const count = pCount.readUInt32LE(0);
  const base = ppSess.readBigUInt64LE(0);
  const results: WtsSession[] = [];
  for (let i = 0; i < count; i++) {
    const mem = ffi().viewSource(base + BigInt(i * 24), 24);
    const dv = new DataView(mem);
    const id = dv.getUint32(0, true);
    const np = dv.getBigUint64(8, true);
    const sv = dv.getUint32(16, true);
    const name = readWString(ffi().viewSource(np, 256));
    const state = (Object.entries(WTS_CONNECTSTATE_CLASS).find(([, v]) => v === sv)?.[0] ??
      'WTSDown') as WtsConnectState;
    results.push({ sessionId: id, winStationName: name, state });
  }
  lib().symbols.WTSFreeMemory(ffi().ptr(base));
  return results;
}

export function querySessionString(sessionId: number, infoClass: WtsInfoClass): string | null {
  const ppBuf = Buffer.alloc(8);
  const pBytes = Buffer.alloc(4);
  if (
    !lib().symbols.WTSQuerySessionInformationW(
      WTS_CURRENT_SERVER,
      sessionId,
      infoClass,
      ppBuf,
      pBytes
    )
  )
    return null;
  const ptr = ppBuf.readBigUInt64LE(0);
  const bytes = pBytes.readUInt32LE(0);
  const value = readWString(ffi().viewSource(ptr, bytes), bytes);
  lib().symbols.WTSFreeMemory(ffi().ptr(ptr));
  return value;
}

export function isRemoteSession(): boolean {
  try {
    const u32 = dlopen('user32', {
      GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
    });
    return u32.symbols.GetSystemMetrics(0x1000) !== 0; // SM_REMOTESESSION
  } catch {
    return false;
  }
}

export function getClientDisplay(sessionId: number): WtsClientDisplay | null {
  const ppBuf = Buffer.alloc(8);
  const pBytes = Buffer.alloc(4);
  if (
    !lib().symbols.WTSQuerySessionInformationW(
      WTS_CURRENT_SERVER,
      sessionId,
      WTS_INFO_CLASS.WTSClientDisplay,
      ppBuf,
      pBytes
    )
  )
    return null;
  const ptr = ppBuf.readBigUInt64LE(0);
  const dv = new DataView(ffi().viewSource(ptr, 12));
  const res = {
    HorizontalResolution: dv.getUint32(0, true),
    VerticalResolution: dv.getUint32(4, true),
    ColorDepth: dv.getUint32(8, true),
  };
  lib().symbols.WTSFreeMemory(ffi().ptr(ptr));
  return res;
}

export function sendSessionMessage(
  sessionId: number,
  title: string,
  message: string,
  timeoutSec = 0
): boolean {
  const tb = encodeWStr(title),
    mb = encodeWStr(message),
    pr = Buffer.alloc(4);
  return lib().symbols.WTSSendMessageW(
    WTS_CURRENT_SERVER,
    sessionId,
    tb,
    tb.byteLength,
    mb,
    mb.byteLength,
    0x40,
    timeoutSec,
    pr,
    timeoutSec > 0
  );
}

export function disconnectSession(sessionId: number, wait = false): boolean {
  return lib().symbols.WTSDisconnectSession(WTS_CURRENT_SERVER, sessionId, wait);
}

export function logoffSession(sessionId: number, wait = false): boolean {
  return lib().symbols.WTSLogoffSession(WTS_CURRENT_SERVER, sessionId, wait);
}

export const getSessionUsername = (id: number) =>
  querySessionString(id, WTS_INFO_CLASS.WTSUserName);
export const getSessionDomain = (id: number) =>
  querySessionString(id, WTS_INFO_CLASS.WTSDomainName);
export const getWinStationName = (id: number) =>
  querySessionString(id, WTS_INFO_CLASS.WTSWinStationName);
export const getClientName = (id: number) => querySessionString(id, WTS_INFO_CLASS.WTSClientName);

export function dispose() {
  _lib?.close();
  _lib = null;
}
