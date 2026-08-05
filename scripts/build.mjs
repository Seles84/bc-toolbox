/**
 * Builds the extension into dist/:
 *   - manifest.json + static assets
 *   - background.js   (service worker, ES module)
 *   - content.js      (content-script relay, IIFE)
 *   - injected.js     (page-world mod, IIFE, bundles bondage-club-mod-sdk)
 *   - index.html + assets (Vue UI)
 *
 * `--watch` keeps all four bundles rebuilding on change; reload the
 * extension in chrome://extensions to pick changes up.
 */
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

/**
 * Build marker used to detect stale injected scripts in game tabs. Hashed
 * from the sources that shape page-side behavior (injected + shared protocol)
 * so UI-only rebuilds don't false-flag running tabs as outdated.
 */
async function injectedSourcesHash() {
    const hash = createHash('sha256');
    for (const dir of ['src/injected', 'src/shared']) {
        const files = (await readdir(resolve(root, dir))).sort();
        for (const file of files) {
            hash.update(file);
            hash.update(await readFile(join(root, dir, file)));
        }
    }
    return hash.digest('hex').slice(0, 12);
}

const common = {
    root,
    configFile: false,
    logLevel: 'info',
    resolve: { alias: { '@': resolve(root, 'src') } },
    define: {
        __BCT_VERSION__: JSON.stringify(pkg.version),
        __BCT_BUILD__: JSON.stringify(await injectedSourcesHash()),
        __DEV__: JSON.stringify(watch),
    },
};

const SCRIPTS = [
    { name: 'background', entry: 'src/background/main.ts', format: 'es' },
    { name: 'content', entry: 'src/content/relay.ts', format: 'iife' },
    { name: 'injected', entry: 'src/injected/main.ts', format: 'iife' },
];

async function writeStatic() {
    await mkdir(dist, { recursive: true });
    const manifest = buildManifest({ dev: watch, version: pkg.version });
    await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function buildScript({ name, entry, format }) {
    return build({
        ...common,
        build: {
            outDir: dist,
            emptyOutDir: false,
            watch: watch ? {} : undefined,
            target: 'es2022',
            minify: false,
            sourcemap: watch ? 'inline' : false,
            lib: {
                entry: resolve(root, entry),
                name: `bct_${name}`,
                formats: [format],
                fileName: () => `${name}.js`,
            },
        },
    });
}

function buildUi() {
    return build({
        ...common,
        plugins: [vue(), tailwindcss()],
        build: {
            outDir: dist,
            emptyOutDir: false,
            watch: watch ? {} : undefined,
            target: 'es2022',
            sourcemap: watch ? 'inline' : false,
            rollupOptions: {
                input: { index: resolve(root, 'index.html') },
            },
        },
    });
}

await rm(dist, { recursive: true, force: true });
await writeStatic();
await cp(resolve(root, 'public'), dist, { recursive: true });

for (const script of SCRIPTS) {
    await buildScript(script);
}
await buildUi();

if (watch) {
    console.log('\n[bct] watching for changes… (reload the extension to apply)');
}
