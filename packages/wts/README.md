# wts - WTSAPI32 FFI Bindings

Real bindings to **WTSAPI32.DLL** via `bun:ffi`.

## Functions

| Function | Description |
|---|---|
| `enumerateSessions()` | All sessions on the local machine |
| `querySessionString(id, class)` | Any WTS_INFO_CLASS string |
| `isRemoteSession()` | Detect RDP session via SM_REMOTESESSION |
| `getClientDisplay(id)` | Resolution + colour depth |
| `sendSessionMessage(id, title, msg)` | Pop-up in a session |
| `disconnectSession(id)` | Disconnect (stays logged in) |
| `logoffSession(id)` | Full log-off |
| `getSessionUsername/Domain/WinStationName/ClientName(id)` | Convenience wrappers |

## Memory layout: WTS_SESSION_INFOW (x64)

```
+0  DWORD  SessionId
+4  [pad]
+8  LPWSTR pWinStationName
+16 DWORD  State
+20 [pad]
= 24 bytes/entry
```

## Example

```ts
import { enumerateSessions, getClientDisplay } from '.';
for (const s of enumerateSessions()) {
  const d = getClientDisplay(s.sessionId);
  console.log(s.sessionId, s.state, d);
}
```
