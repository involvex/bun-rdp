# bun-rdp

> Remote Desktop System built with **Bun** + **bun-win32** — not RDP, but your own protocol.

## Architecture

```
[DXGI Capture] → [H.264 Encoder] → [WebSocket Broadcast]
                        ↑
             [Input Handler] ← [Client Input]
```

## Stack

| Layer | Technology |
|---|---|
| Screen Capture | DXGI Desktop Duplication / GDI32 fallback |
| Encoding | Media Foundation H.264 |
| Transport | WebSocket (Bun native) / TCP |
| Input | user32.SendInput |
| Session Info | WTSAPI32 |
| Auth | Token-based |

## Project Structure

```
remote-desktop/
├── packages/
│   ├── core-protocol/   # Message types, binary protocol, compression
│   ├── screen-capture/  # DXGI/D3D11/GDI32 capture via bun-win32
│   ├── encoder/         # H.264 encoder (Media Foundation)
│   ├── input/           # Mouse/keyboard injection (user32)
│   ├── transport/       # WebSocket/TCP layer
│   ├── auth/            # Token-based auth, session keys
│   ├── wts/             # WTSAPI32 bindings
│   └── utils/           # Logging, config, shared helpers
├── server/              # Remote Desktop Server
├── client/              # Client app
└── web-ui/              # Browser-based client (Vite)
```

## Requirements

- Windows 10/11
- [Bun](https://bun.sh) >= 1.x
- [bun-win32](https://github.com/nicolo-ribaudo/bun-win32) (Windows-only native bindings)

## Getting Started

```bash
bun install
# Start server
bun run server/index.ts
# Start client
bun run client/index.ts
```

## Protocol Messages

| Type | Description |
|---|---|
| `FRAME` | Encoded video frame |
| `INPUT` | Mouse/keyboard event |
| `CURSOR` | Cursor shape update |
| `CLIPBOARD` | Clipboard sync |
| `PING` | Keepalive |
| `AUTH` | Authentication handshake |

## License

MIT
