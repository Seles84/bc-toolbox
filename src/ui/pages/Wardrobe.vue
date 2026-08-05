<script setup lang="ts">
/**
 * Wardrobe with history: view the live wardrobe, save point-in-time
 * snapshots, browse them offline, and diff any two sources slot by slot.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { WardrobeSlotSnapshot, WardrobeSnapshotRecord, WornItem } from '@/shared/records';
import type { WardrobeSlotInfo } from '@/shared/protocol';
import lz from 'lz-string';
import { api } from '../api';
import { useLiveQuery } from '../composables/useLiveQuery';
import { useSessionStore } from '../stores/session';
import { downloadText, safeFilename } from '../utils/transcript';

const route = useRoute();
const session = useSessionStore();
const viewer = computed(() => Number(route.params.viewer));

// -- Live wardrobe -----------------------------------------------------------

const liveSlots = ref<WardrobeSlotInfo[]>([]);
const liveLoaded = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

const online = computed(() => session.tabs.some((t) => t.memberNumber === viewer.value));

async function loadLive() {
    loading.value = true;
    error.value = null;
    try {
        await session.refreshTabs();
        if (!online.value) {
            error.value = 'Character offline — showing saved snapshots only.';
            liveSlots.value = [];
            liveLoaded.value = false;
            return;
        }
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'player-wardrobe' },
        });
        if (!result.success) {
            error.value = result.error;
            return;
        }
        liveSlots.value = (result.data as { slots: WardrobeSlotInfo[] }).slots;
        liveLoaded.value = true;
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}

// -- Snapshots ---------------------------------------------------------------

const snapshots = useLiveQuery<WardrobeSnapshotRecord[]>(
    () => db.wardrobeSnapshots.where('member').equals(viewer.value).reverse().sortBy('taken'),
    [viewer],
    [],
);

const saving = ref(false);
const savedAt = ref<number | null>(null);

async function saveSnapshot() {
    if (!liveLoaded.value) {
        await loadLive();
        if (!liveLoaded.value) return;
    }
    saving.value = true;
    try {
        const slots: WardrobeSlotSnapshot[] = liveSlots.value.map((slot) => ({
            index: slot.index,
            name: slot.name,
            image: slot.image,
            items: (slot.items ?? []).map((item) => ({ ...item })),
        }));
        await db.wardrobeSnapshots.add({ member: viewer.value, taken: Date.now(), slots });
        savedAt.value = Date.now();
    } finally {
        saving.value = false;
    }
}

async function deleteSnapshot(id?: number) {
    if (id === undefined) return;
    await db.wardrobeSnapshots.delete(id);
    if (source.value === id) source.value = 'live';
    if (compare.value === id) compare.value = '';
}

function snapshotSize(snapshot: WardrobeSnapshotRecord): number {
    return JSON.stringify(snapshot).length;
}

// -- Source / compare selection ----------------------------------------------

type SourceKey = 'live' | number;
const source = ref<SourceKey>('live');
const compare = ref<'' | SourceKey>('');
const expanded = ref<number | null>(null);

watch(viewer, () => {
    source.value = 'live';
    compare.value = '';
    expanded.value = null;
    savedAt.value = null;
    void loadLive();
});
onMounted(loadLive);

interface DisplaySlot {
    index: number;
    name: string;
    image?: string;
    items: WornItem[];
}

function slotsOf(key: SourceKey): DisplaySlot[] | null {
    if (key === 'live') {
        return liveLoaded.value
            ? liveSlots.value.map((s) => ({ ...s, items: s.items ?? [] }))
            : null;
    }
    const snapshot = snapshots.value.find((s) => s.id === key);
    return snapshot ? snapshot.slots : null;
}

const shownSlots = computed(() => slotsOf(source.value));
const compareSlots = computed(() => (compare.value === '' ? null : slotsOf(compare.value)));

function sourceLabel(key: SourceKey): string {
    if (key === 'live') return 'Live';
    const snapshot = snapshots.value.find((s) => s.id === key);
    return snapshot ? new Date(snapshot.taken).toLocaleString() : '?';
}

// -- Slot actions (rename / clear) -------------------------------------------

const renamingSlot = ref<number | null>(null);
const renameValue = ref('');
const confirmClearSlot = ref<number | null>(null);
const actionBusy = ref(false);
const actionError = ref<string | null>(null);

const canEdit = computed(() => source.value === 'live' && online.value);

function startRename(slot: DisplaySlot) {
    renamingSlot.value = slot.index;
    renameValue.value = slot.name;
    confirmClearSlot.value = null;
    actionError.value = null;
}

async function applyRename(slot: DisplaySlot) {
    const name = renameValue.value.trim();
    if (!name || actionBusy.value) return;
    actionBusy.value = true;
    actionError.value = null;
    try {
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'wardrobe-rename', slot: slot.index, name },
        });
        if (result.success) {
            renamingSlot.value = null;
            await loadLive();
        } else {
            actionError.value = result.error;
        }
    } catch (e) {
        actionError.value = e instanceof Error ? e.message : String(e);
    } finally {
        actionBusy.value = false;
    }
}

async function clearSlot(slot: DisplaySlot) {
    if (confirmClearSlot.value !== slot.index) {
        confirmClearSlot.value = slot.index;
        renamingSlot.value = null;
        actionError.value = null;
        setTimeout(() => {
            if (confirmClearSlot.value === slot.index) confirmClearSlot.value = null;
        }, 5_000);
        return;
    }
    if (actionBusy.value) return;
    actionBusy.value = true;
    actionError.value = null;
    try {
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'wardrobe-clear', slot: slot.index },
        });
        if (result.success) {
            confirmClearSlot.value = null;
            await loadLive();
        } else {
            actionError.value = result.error;
        }
    } catch (e) {
        actionError.value = e instanceof Error ? e.message : String(e);
    } finally {
        actionBusy.value = false;
    }
}

// -- Rearrange / outfit codes ------------------------------------------------

const rearranging = ref(false);
const swapFirst = ref<number | null>(null);
const copiedSlot = ref<number | null>(null);
const importingSlot = ref<number | null>(null);
const importValue = ref('');

function toggleRearrange() {
    rearranging.value = !rearranging.value;
    swapFirst.value = null;
}

async function onSlotClick(slot: DisplaySlot) {
    if (!rearranging.value) {
        expanded.value = expanded.value === slot.index ? null : slot.index;
        return;
    }
    if (swapFirst.value === null) {
        swapFirst.value = slot.index;
        return;
    }
    if (swapFirst.value === slot.index) {
        swapFirst.value = null;
        return;
    }
    const a = swapFirst.value;
    swapFirst.value = null;
    actionBusy.value = true;
    actionError.value = null;
    try {
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'wardrobe-swap', a, b: slot.index },
        });
        if (result.success) {
            await loadLive();
        } else {
            actionError.value = result.error;
        }
    } finally {
        actionBusy.value = false;
    }
}

async function copyOutfitCode(slot: DisplaySlot) {
    actionError.value = null;
    try {
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'wardrobe-get-bundles', slot: slot.index },
        });
        if (!result.success) {
            actionError.value = result.error;
            return;
        }
        await navigator.clipboard.writeText(lz.compressToBase64(JSON.stringify(result.data)));
        copiedSlot.value = slot.index;
        setTimeout(() => {
            if (copiedSlot.value === slot.index) copiedSlot.value = null;
        }, 2_000);
    } catch (e) {
        actionError.value = e instanceof Error ? e.message : String(e);
    }
}

/** Outfit codes come as LZString base64 (community format) or plain JSON. */
function decodeOutfitCode(code: string): unknown[] | null {
    const trimmed = code.trim();
    for (const attempt of [
        () => JSON.parse(trimmed) as unknown,
        () => JSON.parse(lz.decompressFromBase64(trimmed) || '') as unknown,
    ]) {
        try {
            const parsed = attempt();
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // try the next format
        }
    }
    return null;
}

async function applyImport(slot: DisplaySlot) {
    const bundles = decodeOutfitCode(importValue.value);
    if (!bundles) {
        actionError.value = 'Not a recognizable outfit code';
        return;
    }
    actionBusy.value = true;
    actionError.value = null;
    try {
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'wardrobe-set-bundles', slot: slot.index, bundles },
        });
        if (result.success) {
            importingSlot.value = null;
            importValue.value = '';
            await loadLive();
        } else {
            actionError.value = result.error;
        }
    } finally {
        actionBusy.value = false;
    }
}

async function exportAll() {
    actionError.value = null;
    const result = await api('page.query', {
        memberNumber: viewer.value,
        query: { type: 'wardrobe-all-bundles' },
    });
    if (!result.success) {
        actionError.value = result.error;
        return;
    }
    const payload = {
        format: 'bc-toolbox-wardrobe',
        version: 1,
        member: viewer.value,
        taken: Date.now(),
        ...(result.data as object),
    };
    downloadText(
        `wardrobe-${safeFilename(session.viewerName ?? String(viewer.value))}-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(payload, null, 2),
    );
}

// -- Diffing -----------------------------------------------------------------

function itemKey(item: WornItem): string {
    return `${item.group}|${item.asset}|${item.color ?? ''}|${item.craftName ?? ''}`;
}

function slotSignature(items: WornItem[]): string {
    return items.map(itemKey).sort().join('~');
}

interface SlotDiff {
    changed: boolean;
    added: WornItem[];
    removed: WornItem[];
}

const diffs = computed<Map<number, SlotDiff> | null>(() => {
    const base = shownSlots.value;
    const other = compareSlots.value;
    if (!base || !other) return null;
    const otherByIndex = new Map(other.map((s) => [s.index, s]));
    const result = new Map<number, SlotDiff>();
    for (const slot of base) {
        const counterpart = otherByIndex.get(slot.index);
        const otherItems = counterpart?.items ?? [];
        if (slotSignature(slot.items) === slotSignature(otherItems)) {
            result.set(slot.index, { changed: false, added: [], removed: [] });
            continue;
        }
        const otherKeys = new Set(otherItems.map(itemKey));
        const baseKeys = new Set(slot.items.map(itemKey));
        result.set(slot.index, {
            changed: true,
            added: slot.items.filter((i) => !otherKeys.has(itemKey(i))),
            removed: otherItems.filter((i) => !baseKeys.has(itemKey(i))),
        });
    }
    return result;
});

const changedCount = computed(
    () => (diffs.value ? [...diffs.value.values()].filter((d) => d.changed).length : 0),
);
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center gap-3">
            <h1 class="text-2xl font-semibold text-white">Wardrobe</h1>

            <select v-model="source" class="input w-auto py-1.5">
                <option value="live">Live</option>
                <option v-for="snapshot in snapshots" :key="snapshot.id" :value="snapshot.id">
                    {{ new Date(snapshot.taken).toLocaleString() }}
                </option>
            </select>

            <label class="flex items-center gap-1.5 text-sm text-neutral-500">
                vs
                <select v-model="compare" class="input w-auto py-1.5">
                    <option value="">—</option>
                    <option v-if="source !== 'live'" value="live">Live</option>
                    <option
                        v-for="snapshot in snapshots.filter((s) => s.id !== source)"
                        :key="snapshot.id"
                        :value="snapshot.id"
                    >
                        {{ new Date(snapshot.taken).toLocaleString() }}
                    </option>
                </select>
            </label>

            <span v-if="diffs" class="text-sm" :class="changedCount ? 'text-amber-300' : 'text-emerald-400'">
                {{ changedCount ? `${changedCount} slots differ` : 'No differences' }}
            </span>

            <div class="ml-auto flex items-center gap-2">
                <button
                    v-if="canEdit"
                    class="btn"
                    :class="rearranging ? 'btn-accent' : ''"
                    @click="toggleRearrange"
                >
                    {{ rearranging ? 'Done rearranging' : 'Rearrange' }}
                </button>
                <button v-if="canEdit" class="btn" @click="exportAll">Export all</button>
                <button class="btn" :disabled="loading" @click="loadLive">
                    {{ loading ? 'Loading…' : 'Refresh live' }}
                </button>
                <button
                    class="btn btn-accent"
                    :disabled="saving || !online"
                    :title="online ? 'Save the live wardrobe as a snapshot' : 'Character must be online'"
                    @click="saveSnapshot"
                >
                    {{ saving ? 'Saving…' : 'Save snapshot' }}
                </button>
                <span v-if="savedAt" class="text-xs text-emerald-400">Saved</span>
            </div>
        </div>

        <p v-if="error" class="mb-4 text-sm text-amber-400">{{ error }}</p>
        <p v-if="rearranging" class="mb-4 text-sm text-accent-soft">
            Rearrange mode: click one slot, then another, to swap them.
            <template v-if="swapFirst !== null"> First slot: {{ swapFirst + 1 }} — pick the second.</template>
        </p>
        <p v-if="(shownSlots?.length ?? 0) > 96" class="mb-4 text-xs text-neutral-600">
            Slots 97+ (WCE local wardrobe) are captured with item lists but no preview images, to
            keep captures fast and snapshots small.
        </p>

        <div v-if="!shownSlots" class="card mx-auto max-w-lg p-8 text-center text-neutral-400">
            <template v-if="source === 'live'">
                No live wardrobe loaded.
                <template v-if="snapshots.length">
                    Pick a snapshot from the dropdown to browse offline.
                </template>
            </template>
            <template v-else>Snapshot not found.</template>
        </div>

        <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <div
                v-for="slot in shownSlots"
                :key="slot.index"
                class="card cursor-pointer overflow-hidden"
                :class="[
                    diffs?.get(slot.index)?.changed ? 'border-amber-500/50' : '',
                    rearranging && swapFirst === slot.index ? '!border-accent ring-1 ring-accent' : '',
                ]"
                @click="onSlotClick(slot)"
            >
                <div class="flex h-52 items-center justify-center bg-surface-2/60 p-2">
                    <img v-if="slot.image" :src="slot.image" alt="" class="h-full object-contain" />
                    <span v-else class="px-4 text-center text-xs text-neutral-600">No preview</span>
                </div>
                <div class="p-3">
                    <div class="flex items-center gap-2">
                        <span class="truncate text-sm font-medium text-white">{{ slot.name }}</span>
                        <span
                            v-if="diffs?.get(slot.index)?.changed"
                            class="ml-auto shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                            >changed</span
                        >
                    </div>
                    <div class="text-xs text-neutral-500">
                        Slot {{ slot.index + 1 }} · {{ slot.items.length }} items
                    </div>

                    <div v-if="canEdit" class="mt-1.5" @click.stop>
                        <form
                            v-if="renamingSlot === slot.index"
                            class="flex items-center gap-1"
                            @submit.prevent="applyRename(slot)"
                        >
                            <input
                                v-model="renameValue"
                                class="input min-w-0 flex-1 px-1.5 py-0.5 text-xs"
                                maxlength="20"
                            />
                            <button type="submit" class="btn px-1.5 py-0.5 text-[10px]" :disabled="actionBusy">
                                Save
                            </button>
                            <button
                                type="button"
                                class="btn px-1.5 py-0.5 text-[10px]"
                                @click="renamingSlot = null"
                            >
                                ✕
                            </button>
                        </form>
                        <form
                            v-else-if="importingSlot === slot.index"
                            class="flex flex-col gap-1"
                            @submit.prevent="applyImport(slot)"
                        >
                            <input
                                v-model="importValue"
                                class="input px-1.5 py-0.5 text-xs"
                                placeholder="Paste outfit code…"
                            />
                            <div class="flex gap-1">
                                <button type="submit" class="btn px-1.5 py-0.5 text-[10px]" :disabled="actionBusy">
                                    Replace slot
                                </button>
                                <button
                                    type="button"
                                    class="btn px-1.5 py-0.5 text-[10px]"
                                    @click="importingSlot = null"
                                >
                                    ✕
                                </button>
                            </div>
                        </form>
                        <div v-else class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <button
                                class="text-[11px] text-neutral-500 hover:text-white"
                                @click="startRename(slot)"
                            >
                                Rename
                            </button>
                            <button
                                class="text-[11px] text-neutral-500 hover:text-white"
                                @click="copyOutfitCode(slot)"
                            >
                                {{ copiedSlot === slot.index ? 'Copied!' : 'Copy code' }}
                            </button>
                            <button
                                class="text-[11px] text-neutral-500 hover:text-white"
                                @click="
                                    importingSlot = slot.index;
                                    importValue = '';
                                    confirmClearSlot = null;
                                "
                            >
                                Import
                            </button>
                            <button
                                class="text-[11px]"
                                :class="
                                    confirmClearSlot === slot.index
                                        ? 'font-medium text-rose-300'
                                        : 'text-neutral-500 hover:text-rose-300'
                                "
                                :disabled="actionBusy"
                                @click="clearSlot(slot)"
                            >
                                {{ confirmClearSlot === slot.index ? 'Really clear?' : 'Clear' }}
                            </button>
                        </div>
                        <p
                            v-if="
                                actionError &&
                                (renamingSlot === slot.index ||
                                    confirmClearSlot === slot.index ||
                                    importingSlot === slot.index)
                            "
                            class="mt-1 text-[10px] text-red-400"
                        >
                            {{ actionError }}
                        </p>
                    </div>

                    <div v-if="expanded === slot.index" class="mt-2 border-t border-white/10 pt-2 text-xs">
                        <template v-if="diffs?.get(slot.index)?.changed">
                            <p
                                v-for="item in diffs.get(slot.index)!.added"
                                :key="'a' + itemKey(item)"
                                class="text-emerald-300"
                            >
                                + {{ item.name }}
                                <span class="text-neutral-600">{{ item.groupLabel }}</span>
                            </p>
                            <p
                                v-for="item in diffs.get(slot.index)!.removed"
                                :key="'r' + itemKey(item)"
                                class="text-rose-300"
                            >
                                − {{ item.name }}
                                <span class="text-neutral-600">{{ item.groupLabel }}</span>
                            </p>
                            <p class="mt-1 text-neutral-600">vs {{ sourceLabel(compare as any) }}</p>
                        </template>
                        <template v-else>
                            <p v-if="slot.items.length === 0" class="text-neutral-500">Nothing worn.</p>
                            <p v-for="item in slot.items" :key="itemKey(item)" class="text-neutral-300">
                                {{ item.name }}
                                <span class="text-neutral-600">{{ item.groupLabel }}</span>
                                <span v-if="item.lock" class="text-amber-300/80">🔒</span>
                            </p>
                        </template>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="snapshots.length" class="card mt-6 p-4">
            <h2 class="mb-2 text-sm font-semibold text-neutral-400">
                Snapshots ({{ snapshots.length }})
            </h2>
            <ul class="divide-y divide-white/5 text-sm">
                <li
                    v-for="snapshot in snapshots"
                    :key="snapshot.id"
                    class="flex items-center gap-3 py-1.5"
                >
                    <button class="text-neutral-200 hover:underline" @click="source = snapshot.id!">
                        {{ new Date(snapshot.taken).toLocaleString() }}
                    </button>
                    <span class="text-xs text-neutral-600">
                        {{ snapshot.slots.length }} slots ·
                        ~{{ (snapshotSize(snapshot) / 1024 / 1024).toFixed(1) }} MB
                    </span>
                    <button
                        class="ml-auto text-xs text-neutral-500 hover:text-rose-300"
                        @click="deleteSnapshot(snapshot.id)"
                    >
                        Delete
                    </button>
                </li>
            </ul>
        </div>
    </div>
</template>
