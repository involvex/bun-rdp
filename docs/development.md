# Development Guide

## Setup

```bash
git clone https://github.com/involvex/bun-rdp
cd bun-rdp
bun install

# Copy and configure env
cp .env.example .env
# Set BUN_RDP_SECRET, BUN_RDP_TLS=off for local dev
```

## Daily workflow

```bash
# Type-check
bun run typecheck

# Lint
bun run lint

# Auto-fix lint + format
bun run lint:fix

# Run server (dev mode, prints share link)
bun run server:prod

# Run Vite dev server (browser client)
bun run web-ui
# Open: http://localhost:5173?token=<printed above>
```

## Building

```bash
# Full production build
bun run build
# → dist/bun-rdp-server.exe + dist/web-ui/ + dist/*.zip

# Server binary only
bun run build:server

# Web-UI only
bun run build:webui

# NSIS installer (requires NSIS installed)
bun run installer
```

## Running as Windows Service

```powershell
# Install service
sc create bun-rdp binPath= "C:\Program Files\bun-rdp\bun-rdp-server.exe" start= auto
sc description bun-rdp "bun-rdp Remote Desktop Server"
sc start bun-rdp

# With service mode (no tray icon)
# Add to .env: BUN_RDP_HEADLESS=true

# View logs
Get-Content "C:\Program Files\bun-rdp\.rdp-data\audit.log" -Wait
```

## Debugging

```bash
# Verbose logging
LOG_LEVEL=debug bun run server/index.ts

# Disable TLS for easier browser testing
BUN_RDP_TLS=off bun run server/index.ts

# Disable audio (faster startup)
AUDIO=false bun run server/index.ts

# Force GDI32 capture (useful for testing fallback)
# Set BUN_RDP_FORCE_GDI32=true in server/index.ts init
```

## Adding a package

```bash
mkdir packages/myfeature
touch packages/myfeature/index.ts
touch packages/myfeature/README.md
```

See [AGENTS.md](../AGENTS.md) for the full template and conventions.

## Testing

```bash
# Run all tests
bun test

# Run specific package tests
bun test packages/screen-capture/__tests__/

# Watch mode
bun test --watch
```

Tests live in `__tests__/` directories next to their source files.

## CI

Every push to `main` or `dev` runs:
1. `bunx tsc --noEmit` on `windows-latest` (type-check)
2. `bunx @biomejs/biome check .` on `ubuntu-latest` (lint)

Every tag `v*.*.*` runs the full release pipeline (see `.github/workflows/release.yml`).

## Releasing

```bash
# Bump version in package.json
# Update ROADMAP.md
git add -A
git commit -m "chore: release v1.1.0"
git tag v1.1.0
git push && git push --tags
# → CI builds + attaches to GitHub Release automatically
```

## Project conventions

See [AGENTS.md](../AGENTS.md) for:
- Naming conventions
- Commit message format
- Win32 API patterns
- Protocol extension guide
