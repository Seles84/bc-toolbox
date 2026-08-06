<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { db } from '@/shared/db';
import { api } from '../api';

interface BackupSettings {
    enabled: boolean;
    intervalDays: number;
    keep: number;
}

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

// -- Automatic backups -------------------------------------------------------

const backup = ref<BackupSettings>({ enabled: false, intervalDays: 7, keep: 4 });
const lastAutoBackup = ref<number | null>(null);
let backupLoaded = false;

watch(
    backup,
    () => {
        if (backupLoaded) {
            void chrome.storage.local.set({ autoBackup: { ...backup.value } });
        }
    },
    { deep: true },
);

// -- Privacy -----------------------------------------------------------------

const privacy = ref({ capturePaused: false, skipPrivateRooms: false, busyMode: false });
let privacyLoaded = false;

watch(
    privacy,
    () => {
        if (privacyLoaded) {
            void chrome.storage.local.set({ privacy: { ...privacy.value } });
        }
    },
    { deep: true },
);

// -- Keyword alerts ----------------------------------------------------------

const keywords = ref<string[]>([]);
const newKeyword = ref('');
let keywordsLoaded = false;

watch(
    keywords,
    () => {
        if (keywordsLoaded) {
            void chrome.storage.local.set({ alertKeywords: [...keywords.value] });
        }
    },
    { deep: true },
);

function addKeyword() {
    const kw = newKeyword.value.trim();
    if (kw && !keywords.value.some((k) => k.toLowerCase() === kw.toLowerCase())) {
        keywords.value.push(kw);
    }
    newKeyword.value = '';
}

function removeKeyword(kw: string) {
    keywords.value = keywords.value.filter((k) => k !== kw);
}

// -- Retention pruning -------------------------------------------------------

const pruneMonths = ref(6);
const pruning = ref(false);
const prunePreview = ref<{ sessions: number; channels: number; chat: number; beeps: number } | null>(
    null,
);
const pruneDone = ref<string | null>(null);

function pruneCutoff(): number {
    return Date.now() - pruneMonths.value * 30.44 * 86_400_000;
}

async function collectPrunable() {
    const cutoff = pruneCutoff();
    const sessions = await db.playerSessions
        .filter((s) => s.ended > 0 && s.ended < cutoff)
        .toArray();
    const sessionIds = new Set(sessions.map((s) => s.sessionId));
    const channels = await db.chatChannels.filter((c) => sessionIds.has(c.sessionId)).toArray();
    const channelIds = new Set(channels.map((c) => c.id!));
    const chat = await db.chat.filter((l) => channelIds.has(l.channelId)).count();
    const beeps = await db.beeps.filter((b) => b.created < cutoff).count();
    return { sessions, channels, chatCount: chat, beepCount: beeps };
}

async function previewPrune() {
    pruning.value = true;
    pruneDone.value = null;
    try {
        const { sessions, channels, chatCount, beepCount } = await collectPrunable();
        prunePreview.value = {
            sessions: sessions.length,
            channels: channels.length,
            chat: chatCount,
            beeps: beepCount,
        };
    } finally {
        pruning.value = false;
    }
}

async function applyPrune() {
    pruning.value = true;
    try {
        const cutoff = pruneCutoff();
        const { sessions, channels } = await collectPrunable();
        const sessionIds = sessions.map((s) => s.id!);
        const channelIds = channels.map((c) => c.id!);
        const channelIdSet = new Set(channelIds);
        await db.transaction('rw', [db.playerSessions, db.chatChannels, db.chat, db.beeps], async () => {
            await db.chat.filter((l) => channelIdSet.has(l.channelId)).delete();
            await db.chatChannels.bulkDelete(channelIds);
            await db.playerSessions.bulkDelete(sessionIds);
            await db.beeps.filter((b) => b.created < cutoff).delete();
        });
        pruneDone.value = `Pruned ${sessions.length} sessions, ${channels.length} room visits, ${prunePreview.value?.chat ?? '?'} chat lines, ${prunePreview.value?.beeps ?? '?'} beeps.`;
        prunePreview.value = null;
        await refreshCounts();
    } finally {
        pruning.value = false;
    }
}

// -- Appearance image stats & pruning -----------------------------------------

const imageStats = ref<{ count: number; bytes: number } | null>(null);

async function refreshImageStats() {
    let count = 0;
    let bytes = 0;
    await db.members.each((m) => {
        if (m.appearanceImage) {
            count++;
            bytes += m.appearanceImage.length;
        }
    });
    imageStats.value = { count, bytes };
}

/** Months, or 'all' for every non-player member. */
const imagePruneScope = ref<number | 'all'>(6);
const imagePruning = ref(false);
const imagePrunePreview = ref<{ count: number; bytes: number } | null>(null);
const imagePruneDone = ref<string | null>(null);

async function collectPrunableImages(): Promise<{ members: number[]; bytes: number }> {
    const cutoff =
        imagePruneScope.value === 'all'
            ? Infinity
            : Date.now() - imagePruneScope.value * 30.44 * 86_400_000;

    // Latest sighting by ANY of the player's characters.
    const lastSeenByMember = new Map<number, number>();
    await db.memberSeen.each((s) => {
        lastSeenByMember.set(s.member, Math.max(lastSeenByMember.get(s.member) ?? 0, s.lastSeen));
    });

    const members: number[] = [];
    let bytes = 0;
    await db.members.each((m) => {
        if (!m.appearanceImage || m.isPlayer) {
            return; // your own characters' portraits are always kept
        }
        const lastSeen = Math.max(lastSeenByMember.get(m.memberNumber) ?? 0, m.capturedAt ?? 0);
        if (lastSeen < cutoff) {
            members.push(m.memberNumber);
            bytes += m.appearanceImage.length;
        }
    });
    return { members, bytes };
}

async function previewImagePrune() {
    imagePruning.value = true;
    imagePruneDone.value = null;
    try {
        const { members, bytes } = await collectPrunableImages();
        imagePrunePreview.value = { count: members.length, bytes };
    } finally {
        imagePruning.value = false;
    }
}

async function applyImagePrune() {
    imagePruning.value = true;
    try {
        const { members, bytes } = await collectPrunableImages();
        await db.members
            .where('memberNumber')
            .anyOf(members)
            .modify((m) => {
                delete m.appearanceImage;
            });
        imagePruneDone.value = `Removed ${members.length} images, freed ~${formatBytes(bytes)}.`;
        imagePrunePreview.value = null;
        await refreshImageStats();
        await refreshCounts();
    } finally {
        imagePruning.value = false;
    }
}

// -- Image re-encoding -------------------------------------------------------

const reencoding = ref(false);
const reencodeStatus = ref<string | null>(null);

async function reencodeImages() {
    reencoding.value = true;
    reencodeStatus.value = null;
    try {
        const candidates = await db.members
            .filter((m) => !!m.appearanceImage?.startsWith('data:image/png'))
            .toArray();
        let converted = 0;
        let saved = 0;
        for (const member of candidates) {
            const webp = await pngToWebp(member.appearanceImage!);
            if (webp && webp.length < member.appearanceImage!.length) {
                saved += member.appearanceImage!.length - webp.length;
                await db.members.update(member.memberNumber, { appearanceImage: webp });
                converted++;
            }
            reencodeStatus.value = `Converting… ${converted}/${candidates.length}`;
        }
        reencodeStatus.value =
            candidates.length === 0
                ? 'No PNG images left to convert.'
                : `Converted ${converted} images, saved ~${formatBytes(saved)}.`;
        await refreshCounts();
        await refreshImageStats();
    } finally {
        reencoding.value = false;
    }
}

function pngToWebp(dataUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(null);
                return;
            }
            ctx.drawImage(image, 0, 0);
            const webp = canvas.toDataURL('image/webp', 0.85);
            resolve(webp.startsWith('data:image/webp') ? webp : null);
        };
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

onMounted(async () => {
    try {
        const pong = await api('ping', undefined);
        version.value = pong.version;
    } catch {
        version.value = 'background unreachable';
    }
    const stored = await chrome.storage.local.get([
        'autoBackup',
        'lastAutoBackup',
        'alertKeywords',
        'privacy',
    ]);
    privacy.value = { ...privacy.value, ...((stored.privacy as Partial<typeof privacy.value>) ?? {}) };
    privacyLoaded = true;
    backup.value = { ...backup.value, ...((stored.autoBackup as Partial<BackupSettings>) ?? {}) };
    lastAutoBackup.value = (stored.lastAutoBackup as number) ?? null;
    backupLoaded = true;
    keywords.value = (stored.alertKeywords as string[]) ?? [];
    keywordsLoaded = true;
    await refreshCounts();
    await refreshImageStats();
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
            <h2 class="mb-1 font-medium text-white">Privacy</h2>
            <p class="mb-3 text-sm text-neutral-500">
                While paused, nothing new is recorded — live status, wardrobe and sending still
                work. Per-tab pausing is in the toolbar popup.
            </p>
            <div class="flex flex-col gap-2 text-sm">
                <label class="flex cursor-pointer items-center gap-2 text-neutral-300">
                    <input v-model="privacy.capturePaused" type="checkbox" class="accent-accent" />
                    Pause all capture
                </label>
                <label class="flex cursor-pointer items-center gap-2 text-neutral-300">
                    <input v-model="privacy.skipPrivateRooms" type="checkbox" class="accent-accent" />
                    Never record private rooms
                    <span class="text-xs text-neutral-600">
                        (no chat, members or sightings from rooms marked private)</span
                    >
                </label>
                <label class="flex cursor-pointer items-center gap-2 text-neutral-300">
                    <input v-model="privacy.busyMode" type="checkbox" class="accent-accent" />
                    Busy mode — mute notifications
                    <span class="text-xs text-neutral-600">
                        (no keyword or friend alerts; everything is still recorded)</span
                    >
                </label>
            </div>
        </div>

        <div class="card mb-4 p-5">
            <h2 class="mb-1 font-medium text-white">Keyword alerts</h2>
            <p class="mb-3 text-sm text-neutral-500">
                Desktop notification when any of these appear in captured chat (except your own
                messages) while the game tab isn't focused.
            </p>
            <div class="flex flex-wrap items-center gap-1.5">
                <span
                    v-for="kw in keywords"
                    :key="kw"
                    class="flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-xs text-neutral-200"
                >
                    {{ kw }}
                    <button class="text-neutral-500 hover:text-white" @click="removeKeyword(kw)">×</button>
                </span>
                <input
                    v-model="newKeyword"
                    class="input w-40 py-0.5 text-xs"
                    placeholder="Add keyword…"
                    @keydown.enter.prevent="addKeyword"
                />
            </div>
        </div>

        <div class="card mb-4 p-5">
            <h2 class="mb-1 font-medium text-white">Automatic backups</h2>
            <p class="mb-3 text-sm text-neutral-500">
                Periodically exports the database to your Downloads folder (BC Toolbox/…).
            </p>
            <div class="flex flex-wrap items-center gap-4 text-sm">
                <label class="flex cursor-pointer items-center gap-2 text-neutral-300">
                    <input v-model="backup.enabled" type="checkbox" class="accent-accent" />
                    Enabled
                </label>
                <label class="flex items-center gap-2 text-neutral-400">
                    Every
                    <select v-model.number="backup.intervalDays" class="input w-auto py-1">
                        <option :value="1">day</option>
                        <option :value="3">3 days</option>
                        <option :value="7">week</option>
                        <option :value="14">2 weeks</option>
                        <option :value="30">month</option>
                    </select>
                </label>
                <label class="flex items-center gap-2 text-neutral-400">
                    Keep
                    <select v-model.number="backup.keep" class="input w-auto py-1">
                        <option v-for="n in [2, 4, 8, 12]" :key="n" :value="n">{{ n }}</option>
                    </select>
                    files
                </label>
                <span v-if="lastAutoBackup" class="text-xs text-neutral-600">
                    Last: {{ new Date(lastAutoBackup).toLocaleString() }}
                </span>
            </div>
        </div>

        <div class="card mb-4 p-5">
            <h2 class="mb-1 font-medium text-white">Storage management</h2>
            <p class="mb-3 text-sm text-neutral-500">
                Prune old chat history and shrink stored appearance images.
            </p>

            <div class="mb-4 flex flex-wrap items-center gap-3 text-sm">
                <label class="flex items-center gap-2 text-neutral-400">
                    Prune sessions older than
                    <select v-model.number="pruneMonths" class="input w-auto py-1">
                        <option :value="3">3 months</option>
                        <option :value="6">6 months</option>
                        <option :value="12">a year</option>
                    </select>
                </label>
                <button class="btn" :disabled="pruning" @click="previewPrune">
                    {{ pruning ? 'Working…' : 'Preview prune' }}
                </button>
            </div>

            <div
                v-if="prunePreview"
                class="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
            >
                <p class="mb-2 text-neutral-200">
                    Would delete {{ prunePreview.sessions }} sessions, {{ prunePreview.channels }}
                    room visits, {{ prunePreview.chat }} chat lines and {{ prunePreview.beeps }} beeps.
                    Members and notes are kept.
                </p>
                <div class="flex gap-2">
                    <button class="btn btn-accent" :disabled="pruning" @click="applyPrune">
                        Prune now
                    </button>
                    <button class="btn" :disabled="pruning" @click="prunePreview = null">Cancel</button>
                </div>
            </div>
            <p v-if="pruneDone" class="mb-4 text-sm text-emerald-400">{{ pruneDone }}</p>

            <div class="mb-4 border-t border-white/5 pt-4">
                <p class="mb-3 text-sm text-neutral-300">
                    Appearance images:
                    <template v-if="imageStats">
                        <span class="text-white">{{ imageStats.count }}</span> stored ·
                        <span class="text-white">~{{ formatBytes(imageStats.bytes) }}</span>
                    </template>
                    <template v-else>calculating…</template>
                </p>
                <div class="flex flex-wrap items-center gap-3 text-sm">
                    <label class="flex items-center gap-2 text-neutral-400">
                        Remove images of members not seen in
                        <select v-model="imagePruneScope" class="input w-auto py-1">
                            <option :value="3">3 months</option>
                            <option :value="6">6 months</option>
                            <option :value="12">a year</option>
                            <option value="all">(all non-player members)</option>
                        </select>
                    </label>
                    <button class="btn" :disabled="imagePruning" @click="previewImagePrune">
                        {{ imagePruning ? 'Working…' : 'Preview removal' }}
                    </button>
                </div>

                <div
                    v-if="imagePrunePreview"
                    class="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
                >
                    <p class="mb-2 text-neutral-200">
                        Would remove {{ imagePrunePreview.count }} images, freeing
                        ~{{ formatBytes(imagePrunePreview.bytes) }}. Your own characters' portraits
                        are kept, and images come back automatically when you meet people again.
                    </p>
                    <div class="flex gap-2">
                        <button class="btn btn-accent" :disabled="imagePruning" @click="applyImagePrune">
                            Remove images
                        </button>
                        <button class="btn" :disabled="imagePruning" @click="imagePrunePreview = null">
                            Cancel
                        </button>
                    </div>
                </div>
                <p v-if="imagePruneDone" class="mt-3 text-sm text-emerald-400">{{ imagePruneDone }}</p>
            </div>

            <div class="flex items-center gap-3">
                <button class="btn" :disabled="reencoding" @click="reencodeImages">
                    {{ reencoding ? 'Converting…' : 'Convert stored images to WebP' }}
                </button>
                <span v-if="reencodeStatus" class="text-sm text-neutral-400">{{ reencodeStatus }}</span>
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
