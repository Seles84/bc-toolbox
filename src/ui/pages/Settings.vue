<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { db } from '@/shared/db';
import { api } from '../api';

const EXPORT_FORMAT = 'bc-toolbox';

const version = ref('…');
const counts = ref<{ table: string; rows: number; bytes?: number }[]>([]);
const storageUsage = ref<number | null>(null);
const exporting = ref(false);
const measuring = ref(false);

// -- Import state ------------------------------------------------------------

interface PendingImport {
    fileName: string;
    data: Record<string, unknown[]>;
    summary: { table: string; rows: number }[];
}

const fileInput = ref<HTMLInputElement>();
const pendingImport = ref<PendingImport | null>(null);
const importing = ref(false);
const importError = ref<string | null>(null);
const importDone = ref<string | null>(null);

async function refreshCounts() {
    counts.value = await Promise.all(
        db.tables.map(async (table) => ({ table: table.name, rows: await table.count() })),
    );
    try {
        storageUsage.value = (await navigator.storage.estimate()).usage ?? null;
    } catch {
        storageUsage.value = null;
    }
}

onMounted(async () => {
    try {
        const pong = await api('ping', undefined);
        version.value = pong.version;
    } catch {
        version.value = 'background unreachable';
    }
    await refreshCounts();
});

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

const totalMeasured = computed(() => {
    const measured = counts.value.filter((c) => c.bytes !== undefined);
    return measured.length > 0 ? measured.reduce((sum, c) => sum + (c.bytes ?? 0), 0) : null;
});

/** Per-table byte sizes by summing serialized records — slow, on demand. */
async function measureTables() {
    measuring.value = true;
    try {
        for (const entry of counts.value) {
            let bytes = 0;
            await db.table(entry.table).each((record) => {
                bytes += JSON.stringify(record)?.length ?? 0;
            });
            entry.bytes = bytes;
        }
    } finally {
        measuring.value = false;
    }
}

// -- Export ------------------------------------------------------------------

async function exportDatabase() {
    exporting.value = true;
    try {
        const dump: Record<string, unknown[]> = {};
        for (const table of db.tables) {
            dump[table.name] = await table.toArray();
        }
        const blob = new Blob([JSON.stringify({ format: EXPORT_FORMAT, version: 1, data: dump })], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `bc-toolbox-backup-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    } finally {
        exporting.value = false;
    }
}

// -- Import ------------------------------------------------------------------

async function onFileSelected(event: Event) {
    importError.value = null;
    importDone.value = null;
    pendingImport.value = null;

    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
        const parsed = JSON.parse(await file.text()) as {
            format?: string;
            version?: number;
            data?: Record<string, unknown[]>;
        };
        if (parsed.format !== EXPORT_FORMAT || typeof parsed.data !== 'object' || !parsed.data) {
            importError.value = 'Not a BC Toolbox backup file.';
            return;
        }
        const known = new Set(db.tables.map((t) => t.name));
        const summary = Object.entries(parsed.data)
            .filter(([table, rows]) => known.has(table) && Array.isArray(rows))
            .map(([table, rows]) => ({ table, rows: rows.length }));
        if (summary.length === 0) {
            importError.value = 'Backup contains no recognizable tables.';
            return;
        }
        pendingImport.value = { fileName: file.name, data: parsed.data, summary };
    } catch {
        importError.value = 'Could not read that file as JSON.';
    } finally {
        if (fileInput.value) fileInput.value.value = '';
    }
}

async function applyImport() {
    const pending = pendingImport.value;
    if (!pending) return;
    importing.value = true;
    importError.value = null;
    try {
        await db.transaction('rw', db.tables, async () => {
            for (const { table } of pending.summary) {
                await db.table(table).clear();
                await db.table(table).bulkPut(pending.data[table] ?? []);
            }
        });
        importDone.value = `Restored ${pending.summary.reduce((s, t) => s + t.rows, 0)} rows from ${pending.fileName}.`;
        pendingImport.value = null;
        await refreshCounts();
    } catch (error) {
        importError.value = error instanceof Error ? error.message : String(error);
    } finally {
        importing.value = false;
    }
}
</script>

<template>
    <div class="mx-auto max-w-2xl">
        <h1 class="mb-5 text-2xl font-semibold text-white">Settings</h1>

        <div class="card mb-4 p-5">
            <div class="mb-3 flex items-center justify-between">
                <h2 class="font-medium text-white">Database</h2>
                <span v-if="storageUsage !== null" class="text-sm text-neutral-500">
                    ~{{ formatBytes(storageUsage) }} on disk
                </span>
            </div>
            <table class="mb-4 w-full text-sm">
                <tbody>
                    <tr
                        v-for="count in counts"
                        :key="count.table"
                        class="border-b border-white/5 last:border-0"
                    >
                        <td class="py-1.5 text-neutral-400">{{ count.table }}</td>
                        <td class="py-1.5 text-right text-neutral-200">{{ count.rows }} rows</td>
                        <td class="w-24 py-1.5 text-right text-neutral-500">
                            {{ count.bytes !== undefined ? formatBytes(count.bytes) : '' }}
                        </td>
                    </tr>
                    <tr v-if="totalMeasured !== null">
                        <td class="py-1.5 font-medium text-neutral-300">Total (records)</td>
                        <td></td>
                        <td class="py-1.5 text-right font-medium text-neutral-300">
                            {{ formatBytes(totalMeasured) }}
                        </td>
                    </tr>
                </tbody>
            </table>
            <div class="flex flex-wrap gap-2">
                <button class="btn btn-accent" :disabled="exporting" @click="exportDatabase">
                    {{ exporting ? 'Exporting…' : 'Export database (JSON)' }}
                </button>
                <button class="btn" :disabled="measuring" @click="measureTables">
                    {{ measuring ? 'Measuring…' : 'Measure table sizes' }}
                </button>
            </div>
        </div>

        <div class="card mb-4 p-5">
            <h2 class="mb-1 font-medium text-white">Restore from backup</h2>
            <p class="mb-3 text-sm text-neutral-500">
                Restores a BC Toolbox JSON export. Tables present in the backup
                <strong class="text-neutral-300">replace</strong> the current ones.
            </p>

            <input
                ref="fileInput"
                type="file"
                accept="application/json,.json"
                class="text-sm text-neutral-400 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-neutral-200 hover:file:bg-surface-3"
                @change="onFileSelected"
            />

            <div v-if="pendingImport" class="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
                <p class="mb-2 text-sm text-neutral-200">
                    <strong>{{ pendingImport.fileName }}</strong> contains:
                </p>
                <ul class="mb-3 text-sm text-neutral-400">
                    <li v-for="entry in pendingImport.summary" :key="entry.table">
                        {{ entry.table }}: {{ entry.rows }} rows
                    </li>
                </ul>
                <p class="mb-3 text-sm text-amber-300">
                    This replaces the current contents of those tables. Consider exporting first.
                </p>
                <div class="flex gap-2">
                    <button class="btn btn-accent" :disabled="importing" @click="applyImport">
                        {{ importing ? 'Restoring…' : 'Replace database' }}
                    </button>
                    <button class="btn" :disabled="importing" @click="pendingImport = null">Cancel</button>
                </div>
            </div>

            <p v-if="importError" class="mt-3 text-sm text-red-400">{{ importError }}</p>
            <p v-if="importDone" class="mt-3 text-sm text-emerald-400">{{ importDone }}</p>
        </div>

        <p class="text-xs text-neutral-600">BC Toolbox v{{ version }}</p>
    </div>
</template>
