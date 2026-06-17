# AGENTS.md — AI Agent Contribution Guide

This file tells AI coding agents (Copilot, Cursor, Claude, GPT-4, etc.)
how bun-rdp is structured, what conventions to follow, and where to add new features.

---

## Stack & Runtime

| Layer | Technology |
|---|---|
| Runtime | **Bun** ≥ 1.1 (TypeScript native, no transpile step) |
| Windows APIs | **bun-win32** (D3D11, DXGI, MF, user32, gdi32, wtsapi32, mmdevice) |
| Native FFI | **bun:ffi** (for libopus, wtsapi32, user32 extras) |
| Transport | **Bun.serve() WebSocket** (native, no ws/socket.io) |
| Build | `bun build --compile --target bun-windows-x64` |
| Lint/Format | **Biome** (`bunx @biomejs/biome check .`) |
| Type-check | `bunx tsc --noEmit` |

---

## Repository Layout

```
packages/<name>/index.ts   — one package per concern, always export from index.ts
server/index.ts            — main entry, imports from packages/*
client/                    — headless Bun client + renderers
web-ui/src/main.ts         — browser entry point (Vite)
scripts/                   — build, embed, tray, updater
installer/                 — NSIS script
docs/                      — markdown documentation
```

**Rule:** Never import across packages directly — always go through `index.ts`.

---

## Coding Conventions

### TypeScript
- `strict: true` — no `any` (use `unknown` + type guards)
- Prefer `interface` over `type` for object shapes
- Use `const` by default, `let` only when reassignment is needed
- Async: prefer `async/await`, avoid raw `.then()` chains
- Error handling: always catch in `try/catch`, never swallow silently

### Bun-specific
- Use `Bun.serve()` for HTTP/WebSocket — never `node:http`
- Use `Bun.file()` / `Bun.write()` for file I/O
- Use `$` from `bun` for shell commands in scripts
- `bun:ffi` for any Win32 API not covered by bun-win32

### Naming
- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Private class members: `_prefixed`

### Comments
- Every exported function/class needs a JSDoc comment
- Complex algorithms get inline comments explaining *why*, not *what*
- Win32 API calls get a reference URL comment

---

## Adding a New Package

1. Create `packages/<name>/index.ts`
2. Export everything from `index.ts`
3. Add a `README.md` in the package directory
4. Import in `server/index.ts` or wherever needed
5. Add types to `packages/core-protocol/index.ts` if the feature needs a new message type

### Template

```typescript
/**
 * <name> — short description
 *
 * Longer description of what this package does.
 * Win32 API reference if applicable.
 */

export interface MyConfig {
  // ...
}

export class MyFeature {
  constructor(private cfg: MyConfig) {}

  init(): void {
    // ...
  }

  dispose(): void {
    // Always implement dispose() for cleanup
  }
}
```

---

## Adding a New Protocol Message

1. Add the type constant to `packages/core-protocol/index.ts`:
   ```typescript
   export const MessageType = {
     // ...
     MY_MSG: 0x09,
   } as const;
   ```

2. Add the interface:
   ```typescript
   export interface MyMessage {
     type: typeof MessageType.MY_MSG;
     // fields...
   }
   ```

3. Add to the `RdpMessage` union type.

4. Handle in `server/index.ts` `transport.on('message', ...)` switch.

5. Handle in `web-ui/src/main.ts` `ws.onmessage` switch.

---

## Win32 API Patterns

### bun-win32 (high-level)
```typescript
import { User32, Gdi32 } from 'bun-win32';
const dc = User32.GetDC(null);
```

### bun:ffi (low-level, for APIs not in bun-win32)
```typescript
import { dlopen, FFIType } from 'bun:ffi';
const lib = dlopen('kernel32', {
  GetTickCount64: { args: [], returns: FFIType.u64 },
});
const ticks = lib.symbols.GetTickCount64();
```

### Memory access
```typescript
// Read raw memory (bun:ffi)
const buf = (Bun as unknown as { FFI: { viewSource(ptr: bigint, len: number): ArrayBuffer } })
  .FFI.viewSource(address, byteLength);
```

---

## Testing

No test framework is set up yet (see backlog). For now:
- Add a `__tests__/` directory in the package
- Use `bun test` with `.test.ts` files
- Prefer unit tests for pure functions (protocol encoding, CIDR parsing, etc.)

```typescript
import { expect, test } from 'bun:test';
import { mergeRects } from '../packages/screen-capture/dirty-rect';

test('mergeRects merges overlapping rects', () => {
  const result = mergeRects([
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 50, y: 50, w: 100, h: 100 },
  ], 1920, 1080);
  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({ x: 0, y: 0, w: 150, h: 150 });
});
```

---

## Key Files to Know

| File | Purpose |
|---|---|
| `packages/core-protocol/index.ts` | All message types — start here |
| `packages/transport/index.ts` | WebSocket server with security middleware |
| `server/index.ts` | Main loop — capture → encode → broadcast |
| `web-ui/src/main.ts` | Browser client — decode → render → input |
| `packages/encoder/index.ts` | H.264 MF pipeline |
| `packages/screen-capture/index.ts` | DXGI/GDI32 capture |
| `packages/auth/index.ts` | Token issue/verify/refresh |
| `ROADMAP.md` | What's done and what's next |
| `docs/` | Full technical documentation |

---

## Backlog Items (good first contributions)

- [ ] `bun:test` unit tests for `mergeRects`, `IPAllowlist`, `AdaptiveBitrateController`
- [ ] `packages/metrics/index.ts` — Prometheus `/metrics` endpoint
- [ ] Multi-monitor support in `ScreenCapture.init(monitorIndex)`
- [ ] `packages/filetransfer/index.ts` — chunked file transfer over WebSocket
- [ ] WebRTC data channel transport option
- [ ] Session recording to MP4 (`mp4muxer`)
- [ ] `packages/wakeonlan/index.ts` — magic packet sender

---

## Commit Message Format

```
type(scope): short description

feat(audio): add WASAPI loopback capture
fix(encoder): handle keyframe on reconnect
docs(protocol): document AUDIO message type
refactor(transport): extract IP extraction helper
test(security): add CIDR parser unit tests
chore(deps): bump bun-win32 to latest
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`
