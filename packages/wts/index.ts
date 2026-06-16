// WTSAPI32 bindings — Session info, remote session detection, virtual channels
// Windows Terminal Services API

export interface WtsSession {
  sessionId: number;
  winStationName: string;
  state: 'Active' | 'Connected' | 'Disconnected' | 'Idle' | 'Listen' | 'Reset' | 'Down' | 'Init';
}

/**
 * Stub — replace with actual bun-win32 WTSAPI32 FFI bindings
 * See: https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/
 */
export async function enumerateSessions(): Promise<WtsSession[]> {
  // TODO: Call WTSEnumerateSessions via bun-win32
  return [];
}

export async function isRemoteSession(): Promise<boolean> {
  // TODO: Check GetSystemMetrics(SM_REMOTESESSION) via bun-win32
  return false;
}

export async function getSessionInfo(sessionId: number): Promise<Record<string, unknown>> {
  // TODO: WTSQuerySessionInformation via bun-win32
  void sessionId;
  return {};
}
