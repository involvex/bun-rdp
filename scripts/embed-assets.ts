/**
 * embed-assets.ts
 * Reads all files from dist/web-ui/ and generates
 * server/embedded-assets.ts — a map of path → base64 content.
 *
 * The server serves these directly when no external web-ui path is set,
 * making the .exe fully self-contained.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const WEB_UI_DIR = join(process.cwd(), 'dist', 'web-ui');
const OUT_FILE = join(process.cwd(), 'server', 'embedded-assets.ts');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...walkDir(full));
    else results.push(full);
  }
  return results;
}

const files = walkDir(WEB_UI_DIR);
const entries: string[] = [];

for (const file of files) {
  const rel = `/${relative(WEB_UI_DIR, file).replace(/\\/g, '/')}`;
  const ext = extname(file);
  const mime = MIME[ext] ?? 'application/octet-stream';
  const b64 = readFileSync(file).toString('base64');
  entries.push(
    `  ${JSON.stringify(rel)}: { mime: ${JSON.stringify(mime)}, data: ${JSON.stringify(b64)} }`
  );
}

const src = `// AUTO-GENERATED — do not edit manually
// Run: bun run scripts/embed-assets.ts

export const EMBEDDED_ASSETS: Record<string, { mime: string; data: string }> = {
${entries.join(',\n')},
};

/** Serve an embedded asset or return null */
export function serveEmbedded(path: string): Response | null {
  const key    = path === '/' ? '/index.html' : path;
  const asset  = EMBEDDED_ASSETS[key];
  if (!asset) return null;
  const buf = Buffer.from(asset.data, 'base64');
  return new Response(buf, {
    headers: {
      'Content-Type':   asset.mime,
      'Content-Length': String(buf.byteLength),
      'Cache-Control':  'public, max-age=3600',
    },
  });
}
`;

writeFileSync(OUT_FILE, src, 'utf8');
console.log(`[embed] ${files.length} assets → server/embedded-assets.ts`);
