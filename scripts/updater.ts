/**
 * Auto-updater — checks GitHub Releases for a newer version on startup.
 *
 * Flow:
 *   1. Fetch latest release from GitHub API
 *   2. Compare semver against current VERSION
 *   3. If newer: download .zip asset → extract → replace .exe → restart
 *
 * Config:
 *   BUN_RDP_AUTO_UPDATE=false   — disable entirely
 *   BUN_RDP_REPO=involvex/bun-rdp  — override repo slug
 */

const REPO = process.env.BUN_RDP_REPO ?? 'involvex/bun-rdp';
const AUTO_UPDATE = process.env.BUN_RDP_AUTO_UPDATE !== 'false';
const CURRENT = process.env.npm_package_version ?? '0.1.0';
const GH_API = `https://api.github.com/repos/${REPO}/releases/latest`;

interface GhRelease {
  tag_name: string;
  name: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

// ── Semver compare ────────────────────────────────────────────────────────────

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^v/, '');
  const parts = clean.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isNewer(latest: string, current: string): boolean {
  const [la, lb, lc] = parseSemver(latest);
  const [ca, cb, cc] = parseSemver(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

// ── Download helpers ──────────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`[updater] Downloading ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': `bun-rdp/${CURRENT}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  await Bun.write(dest, buf);
  console.log(`[updater] Saved → ${dest}`);
}

async function extractAndReplace(zipPath: string): Promise<void> {
  const { $ } = await import('bun');
  const tmpDir = `${zipPath}.extracted`;

  // Extract ZIP (PowerShell or 7z)
  try {
    await $`powershell Expand-Archive -Path ${zipPath} -DestinationPath ${tmpDir} -Force`;
  } catch {
    await $`7z x ${zipPath} -o${tmpDir} -y`;
  }

  // Replace current .exe (rename trick — Windows locks running binaries)
  const newExe = `${tmpDir}/bun-rdp-server.exe`;
  const selfExe = process.execPath;
  const oldExe = `${selfExe}.old`;

  const { renameSync } = await import('fs');
  renameSync(selfExe, oldExe);
  renameSync(newExe, selfExe);

  console.log('[updater] Binary replaced — restarting…');

  // Restart the process
  const { spawn } = await import('child_process');
  const child = spawn(selfExe, process.argv.slice(2), {
    detached: true,
    stdio: 'inherit',
    env: { ...process.env, BUN_RDP_AUTO_UPDATE: 'false' }, // prevent update loop
  });
  child.unref();
  process.exit(0);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function checkForUpdates(): Promise<void> {
  if (!AUTO_UPDATE) return;

  try {
    console.log(`[updater] Checking for updates (current: v${CURRENT})…`);
    const res = await fetch(GH_API, { headers: { 'User-Agent': `bun-rdp/${CURRENT}` } });
    if (!res.ok) {
      console.warn(`[updater] GitHub API ${res.status}`);
      return;
    }

    const release = (await res.json()) as GhRelease;
    const latest = release.tag_name.replace(/^v/, '');

    if (!isNewer(latest, CURRENT)) {
      console.log(`[updater] Up to date (v${CURRENT})`);
      return;
    }

    console.log(`[updater] New version available: v${latest} → downloading…`);

    // Find the win-x64 ZIP asset
    const asset = release.assets.find((a) => a.name.includes('win-x64') && a.name.endsWith('.zip'));
    if (!asset) {
      console.warn('[updater] No win-x64 asset found in release');
      return;
    }

    const zipPath = `bun-rdp-update-${latest}.zip`;
    await downloadFile(asset.browser_download_url, zipPath);
    await extractAndReplace(zipPath);
  } catch (e) {
    console.warn('[updater] Update check failed:', e);
  }
}
