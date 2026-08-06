<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { MemberRecord, MemberSeenRecord } from '@/shared/records';
import { useLiveQuery } from '../composables/useLiveQuery';
import { useSessionStore } from '../stores/session';
import { autoTagsFor, availableAutoTags, PRESET_TAGS, tagClass } from '../utils/tags';
import type { AutoTag } from '../utils/tags';

const PAGE_SIZE = 48;

const session = useSessionStore();
const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));

const search = ref('');
const query = ref('');
const page = ref(1);
const tagFilter = ref('');

let debounce: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
        page.value = 1;
        query.value = search.value.trim().toLowerCase();
    }, 250);
});

interface MembersData {
    rows: MemberRecord[];
    total: number;
    seen: Map<number, MemberSeenRecord>;
    tags: Map<number, string[]>;
    allTags: string[];
    autoTags: Map<number, AutoTag[]>;
    autoTagNames: string[];
}

const data = useLiveQuery<MembersData>(
    async () => {
        const noteRows = await db.notes.where('viewer').equals(viewer.value).toArray();
        const tags = new Map(noteRows.filter((n) => n.tags.length).map((n) => [n.member, n.tags]));
        const allTags = [...new Set(noteRows.flatMap((n) => n.tags))].sort();

        // The viewing character's own record carries the relationship lists
        // (owner, lovers, subs, friend/white/black/ghost) that drive auto tags.
        const viewerRecord = await db.members.get(viewer.value);
        const autoTagNames = availableAutoTags(viewerRecord);

        let collection = db.members.orderBy('name');
        if (tagFilter.value) {
            const wanted = tagFilter.value.toLowerCase();
            collection = collection.filter(
                (m) =>
                    (tags.get(m.memberNumber) ?? []).some((t) => t.toLowerCase() === wanted) ||
                    autoTagsFor(viewerRecord, m.memberNumber).some(
                        (t) => t.tag.toLowerCase() === wanted,
                    ),
            );
        }
        const q = query.value;
        if (q) {
            collection = collection.filter(
                (m) =>
                    m.name.toLowerCase().includes(q) ||
                    (m.nickname ?? '').toLowerCase().includes(q) ||
                    String(m.memberNumber).includes(q) ||
                    (m.nameHistory ?? []).some(
                        (h) =>
                            (h.name ?? '').toLowerCase().includes(q) ||
                            (h.nickname ?? '').toLowerCase().includes(q),
                    ),
            );
        }
        const total = await collection.clone().count();
        const rows = await collection
            .offset((page.value - 1) * PAGE_SIZE)
            .limit(PAGE_SIZE)
            .toArray();
        const seenRows = await db.memberSeen.where('viewer').equals(viewer.value).toArray();
        const autoTags = new Map(
            rows.map((m) => [m.memberNumber, autoTagsFor(viewerRecord, m.memberNumber)]),
        );
        return {
            rows,
            total,
            seen: new Map(seenRows.map((s) => [s.member, s])),
            tags,
            allTags,
            autoTags,
            autoTagNames,
        };
    },
    [query, page, viewer, tagFilter],
    {
        rows: [],
        total: 0,
        seen: new Map(),
        tags: new Map(),
        allTags: [],
        autoTags: new Map(),
        autoTagNames: [],
    },
);

const pages = computed(() => Math.max(1, Math.ceil(data.value.total / PAGE_SIZE)));

watch(pages, (value) => {
    if (page.value > value) page.value = 1;
});

function formatDate(timestamp?: number): string {
    return timestamp ? new Date(timestamp).toLocaleString() : '—';
}

// -- Bulk tagging ------------------------------------------------------------

const selectMode = ref(false);
const selected = ref(new Set<number>());
const bulkTag = ref(PRESET_TAGS[0].tag);
const bulkBusy = ref(false);
const bulkStatus = ref<string | null>(null);

const bulkTagOptions = computed(() => [
    ...new Set([...PRESET_TAGS.map((p) => p.tag), ...data.value.allTags]),
]);

function toggleSelectMode() {
    selectMode.value = !selectMode.value;
    selected.value = new Set();
    bulkStatus.value = null;
}

function onCardClick(event: MouseEvent, memberNumber: number) {
    if (!selectMode.value) return;
    event.preventDefault();
    const next = new Set(selected.value);
    if (next.has(memberNumber)) {
        next.delete(memberNumber);
    } else {
        next.add(memberNumber);
    }
    selected.value = next;
}

async function bulkApply(remove: boolean) {
    if (selected.value.size === 0 || !bulkTag.value) return;
    bulkBusy.value = true;
    try {
        const tag = bulkTag.value;
        for (const member of selected.value) {
            const note = await db.notes.where('[member+viewer]').equals([member, viewer.value]).first();
            const tags = note?.tags ?? [];
            const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
            if (remove && has) {
                const nextTags = tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
                await db.notes.update(note!.id!, { tags: nextTags, updated: Date.now() });
            } else if (!remove && !has) {
                if (note?.id !== undefined) {
                    await db.notes.update(note.id, { tags: [...tags, tag], updated: Date.now() });
                } else {
                    await db.notes.add({
                        member,
                        viewer: viewer.value,
                        note: '',
                        tags: [tag],
                        updated: Date.now(),
                    });
                }
            }
        }
        bulkStatus.value = `${remove ? 'Removed' : 'Applied'} "${tag}" ${remove ? 'from' : 'to'} ${selected.value.size} members.`;
    } finally {
        bulkBusy.value = false;
    }
}
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center gap-4">
            <h1 class="text-2xl font-semibold text-white">Members</h1>
            <span class="text-sm text-neutral-500">{{ data.total }} known</span>
            <div class="ml-auto flex items-center gap-2">
                <select
                    v-if="data.allTags.length || data.autoTagNames.length"
                    v-model="tagFilter"
                    class="input w-auto py-1.5"
                >
                    <option value="">All tags</option>
                    <optgroup v-if="data.autoTagNames.length" label="Auto">
                        <option v-for="tag in data.autoTagNames" :key="tag" :value="tag">
                            {{ tag }}
                        </option>
                    </optgroup>
                    <optgroup v-if="data.allTags.length" label="Yours">
                        <option v-for="tag in data.allTags" :key="tag" :value="tag">
                            {{ tag }}
                        </option>
                    </optgroup>
                </select>
                <input v-model="search" class="input max-w-xs" placeholder="Search name or ID…" />
                <button class="btn" :class="selectMode ? 'btn-accent' : ''" @click="toggleSelectMode">
                    {{ selectMode ? 'Done' : 'Select' }}
                </button>
            </div>
        </div>

        <div
            v-if="selectMode"
            class="card mb-4 flex flex-wrap items-center gap-3 p-3 text-sm"
        >
            <span class="text-neutral-400">{{ selected.size }} selected</span>
            <select v-model="bulkTag" class="input w-auto py-1">
                <option v-for="tag in bulkTagOptions" :key="tag" :value="tag">{{ tag }}</option>
            </select>
            <button
                class="btn btn-accent"
                :disabled="bulkBusy || selected.size === 0"
                @click="bulkApply(false)"
            >
                Apply tag
            </button>
            <button class="btn" :disabled="bulkBusy || selected.size === 0" @click="bulkApply(true)">
                Remove tag
            </button>
            <span v-if="bulkStatus" class="text-emerald-400">{{ bulkStatus }}</span>
        </div>

        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <RouterLink
                v-for="member in data.rows"
                :key="member.memberNumber"
                :to="{ name: 'member', params: { viewer, member: member.memberNumber } }"
                class="card group relative overflow-hidden transition-transform hover:-translate-y-0.5 hover:border-accent-soft/40"
                :class="selectMode && selected.has(member.memberNumber) ? '!border-accent' : ''"
                @click="onCardClick($event, member.memberNumber)"
            >
                <span
                    v-if="selectMode"
                    class="absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded border text-xs"
                    :class="
                        selected.has(member.memberNumber)
                            ? 'border-accent bg-accent text-white'
                            : 'border-white/30 bg-surface/70 text-transparent'
                    "
                    >✓</span
                >
                <div class="flex h-44 items-center justify-center bg-surface-2/60 p-2">
                    <img
                        v-if="member.appearanceImage"
                        :src="member.appearanceImage"
                        alt=""
                        class="h-full object-contain"
                    />
                    <span v-else class="text-3xl text-neutral-600">?</span>
                </div>
                <div class="space-y-0.5 p-3 text-sm">
                    <div class="flex items-center gap-1.5">
                        <span
                            v-if="session.onlineFriendNumbers.has(member.memberNumber)"
                            class="h-2 w-2 shrink-0 rounded-full bg-emerald-400"
                            title="Online now"
                        />
                        <span
                            class="truncate font-medium"
                            :style="{ color: member.labelColor || '#ffffff' }"
                        >
                            {{ member.nickname || member.name }}
                        </span>
                    </div>
                    <div class="text-xs text-neutral-500">#{{ member.memberNumber }}</div>
                    <div
                        v-if="
                            data.autoTags.get(member.memberNumber)?.length ||
                            data.tags.get(member.memberNumber)?.length
                        "
                        class="flex flex-wrap gap-1"
                    >
                        <span
                            v-for="auto in data.autoTags.get(member.memberNumber)"
                            :key="auto.tag"
                            class="rounded px-1 py-px text-[10px] font-medium"
                            :class="auto.class"
                            :title="auto.title"
                            >{{ auto.tag }}</span
                        >
                        <span
                            v-for="tag in (data.tags.get(member.memberNumber) ?? []).slice(0, 3)"
                            :key="tag"
                            class="rounded px-1 py-px text-[10px] font-medium"
                            :class="tagClass(tag)"
                            >{{ tag }}</span
                        >
                    </div>
                    <div class="text-xs text-neutral-500">
                        Seen {{ formatDate(data.seen.get(member.memberNumber)?.lastSeen) }}
                        <template v-if="data.seen.get(member.memberNumber)?.lastLocation">
                            · {{ data.seen.get(member.memberNumber)?.lastLocation }}
                        </template>
                    </div>
                </div>
            </RouterLink>
        </div>

        <div v-if="pages > 1" class="mt-6 flex items-center justify-center gap-3">
            <button class="btn" :disabled="page <= 1" @click="page--">Previous</button>
            <span class="text-sm text-neutral-400">Page {{ page }} / {{ pages }}</span>
            <button class="btn" :disabled="page >= pages" @click="page++">Next</button>
        </div>
    </div>
</template>
