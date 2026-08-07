/**
 * Packages dist/ into a distribution-ready zip (release/bc-toolbox-vX.Y.Z.zip)
 * with manifest.json at the archive root — the layout GitHub release assets
 * and Chrome Web Store uploads both expect. Runs as part of `yarn release:*`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'manifest.json'))) {
    console.error('[bct] dist/manifest.json missing — run yarn build first. Zip skipped.');
    process.exit(1);
}

const candidates = ['7z', 'C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'];
const sevenZip = candidates.find(
    (candidate) => spawnSync(candidate, ['i'], { stdio: 'ignore' }).status === 0,
);
if (!sevenZip) {
    console.error('[bct] 7-Zip not found — install it or add 7z to PATH. Zip skipped.');
    process.exit(1);
}

const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const archive = join(outDir, `bc-toolbox-v${version}.zip`);
// 7z 'a' would merge into an existing archive — always start clean.
rmSync(archive, { force: true });

const result = spawnSync(sevenZip, ['a', '-tzip', '-mx=9', archive, `${dist}\\*`], {
    stdio: ['ignore', 'pipe', 'inherit'],
});

if (result.status !== 0 || !existsSync(archive)) {
    console.error('[bct] release zip FAILED');
    process.exit(1);
}

const size = statSync(archive).size;
console.log(`[bct] release zip: ${archive} (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`[bct] attach it at https://github.com/Seles84/bc-toolbox/releases/new?tag=v${version}`);
