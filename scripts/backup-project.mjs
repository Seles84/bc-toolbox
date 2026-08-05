/**
 * Snapshots the whole project (including .git, excluding rebuildable output)
 * to a 7z archive in E:\Projects\Personal\BCT_Backups — an external rollback
 * point independent of the working tree. Runs as part of `yarn release:*`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupDir = 'E:\\Projects\\Personal\\BCT_Backups';

const candidates = ['7z', 'C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'];
const sevenZip = candidates.find(
    (candidate) => spawnSync(candidate, ['i'], { stdio: 'ignore' }).status === 0,
);
if (!sevenZip) {
    console.error('[bct] 7-Zip not found — install it or add 7z to PATH. Backup skipped.');
    process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const archive = join(backupDir, `bc-toolbox-v${version}-${stamp}.7z`);

const result = spawnSync(
    sevenZip,
    [
        'a',
        '-t7z',
        '-mx=5',
        archive,
        `${root}\\*`,
        '-xr!node_modules',
        '-xr!dist',
        '-xr!dist-firefox',
        '-xr!*.tsbuildinfo',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
);

if (result.status !== 0 || !existsSync(archive)) {
    console.error('[bct] project backup FAILED');
    process.exit(1);
}

const size = statSync(archive).size;
console.log(`[bct] project backed up: ${archive} (${(size / 1024 / 1024).toFixed(1)} MB)`);
