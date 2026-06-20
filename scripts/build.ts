import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
/**
 * build.ts — Production build script
 *
 * Usage:
 *   bun run scripts/build.ts            # server .exe + web-ui bundle
 *   bun run scripts/build.ts --server   # server only
 *   bun run scripts/build.ts --webui    # web-ui only
 *
 * Output:
 *   dist/bun-rdp-server.exe             # standalone Windows binary
 *   dist/web-ui/                        # static browser client
 *   dist/bun-rdp-<version>-win-x64.zip # release archive
 */
import { $ } from 'bun';

const VERSION =
  process.env.npm_package_version ??
  (await $`git describe --tags --abbrev=0`.text().catch(() => '0.1.0')).trim();

const DIST = join(process.cwd(), 'dist');
const ARGS = process.argv.slice(2);
const SERVER = ARGS.includes('--server') || !ARGS.includes('--webui');
const WEBUI = ARGS.includes('--webui') || !ARGS.includes('--server');

console.log(`\n🔨 bun-rdp build  v${VERSION}\n`);

// ── Clean dist ────────────────────────────────────────────────────────────────
if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(DIST, { recursive: true });

// ── Build web-ui (Vite) ───────────────────────────────────────────────────────
if (WEBUI) {
  console.log('📦 Building web-ui…');
  await $`bun run --cwd web-ui vite build --outDir ../dist/web-ui`;
  console.log('   ✅ dist/web-ui/');
}

// ── Embed web-ui assets into server ──────────────────────────────────────────
// Generates server/embedded-assets.ts with base64-encoded static files
if (SERVER && WEBUI) {
  console.log('📎 Embedding web-ui assets…');
  await $`bun run scripts/embed-assets.ts`;
}

// ── Compile server binary ─────────────────────────────────────────────────────
if (SERVER) {
  console.log('🔧 Compiling server…');
  const outExe = join(DIST, 'bun-rdp-server.exe');
  await $`bun build server/index.ts \
    --compile \
    --target bun-windows-x64 \
    --outfile ${outExe} \
    --minify`;
  console.log('   ✅ dist/bun-rdp-server.exe');
}

// ── Create release ZIP ────────────────────────────────────────────────────────
console.log('🗜️  Creating release archive…');
const zipName = `bun-rdp-${VERSION}-win-x64.zip`;
const zipPath = join(DIST, zipName);

// Bundle: server.exe + web-ui/ + README + .env.example
await $`pwsh -C Compress-Archive \
  -Path dist\\bun-rdp-server.exe,dist\\web-ui,README.md,.env.example \
  -DestinationPath ${zipPath}`.catch(async () => {
  // Fallback: use 7z if available
  await $`7z a ${zipPath} dist/bun-rdp-server.exe dist/web-ui README.md .env.example`;
});

console.log(`   ✅ dist/${zipName}`);
console.log(`\n✅ Build complete — v${VERSION}\n`);
