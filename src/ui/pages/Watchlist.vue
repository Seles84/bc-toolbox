<script setup lang="ts">
/**
 * Every member the selected character has tagged, filterable by tag, with
 * online status, last sighting and note excerpt.
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { MemberNoteRecord, MemberRecord, MemberSeenRecord } from '@/shared/records';
import { useLiveQuery } from '../composables/useLiveQuery';
import { useSessionStore } from '../stores/session';
import { tagClass } from '../utils/tags';

const route = useRoute();
const session = useSessionStore();
const viewer = computed(() => Number(route.params.viewer));
const tagFilter = ref('');

interface WatchRow {
    member: number;
    record: MemberRecord | undefined;
    note: MemberNoteRecord;
    seen: MemberSeenRecord | undefined;
}

const data = useLiveQuery(
    async () => {
        const notes = (await db.notes.where('viewer').equals(viewer.value).toArray()).filter(
            (n) => n.tags.length > 0 || n.note.trim().length > 0,
        );
        const records = await db.members.bulkGet(notes.map((n) => n.member));
        const seenRows = await db.memberSeen.where('viewer').equals(viewer.value).toArray();
        const seenByMember = new Map(seenRows.map((s) => [s.member, s]));

        const rows: WatchRow[] = notes.map((note, index) => ({
            member: note.member,
            record: records[index],
            note,
            seen: seenByMember.get(note.member),
        }));
        const allTags = [...new Set(notes.flatMap((n) => n.tags))].sort();
        return { rows, allTags };
    },
    [viewer],
    { rows: [] as WatchRow[], allTags: [] as string[] },
);

const filtered = computed(() => {
    const wanted = tagFilter.value.toLowerCase();
    const rows = wanted
        ? data.value.rows.filter((r) => r.note.tags.some((t) => t.toLowerCase() === wanted))
        : data.value.rows;
    return [...rows].sort((a, b) => {
        const aOnline = session.onlineFriendNumbers.has(a.member) ? 1 : 0;
        const bOnline = session.onlineFriendNumbers.has(b.member) ? 1 : 0;
        return bOnline - aOnline || (b.seen?.lastSeen ?? 0) - (a.seen?.lastSeen ?? 0);
    });
});

function nameOf(row: WatchRow): string {
    return row.record ? row.record.nickname || row.record.name : `#${row.member}`;
}

function formatDate(timestamp?: number): string {
    return timestamp ? new Date(timestamp).toLocaleString() : 'never';
}
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center gap-4">
            <h1 class="text-2xl font-semibold text-white">Watchlist</h1>
            <span class="text-sm text-neutral-500">{{ filtered.length }} tagged</span>
            <select
                v-if="data.allTags.length"
                v-model="tagFilter"
                class="input ml-auto w-auto py-1.5"
            >
                <option value="">All tags</option>
                <option v-for="tag in data.allTags" :key="tag" :value="tag">{{ tag }}</option>
            </select>
        </div>

        <div v-if="filtered.length === 0" class="card mx-auto max-w-md p-8 text-center text-neutral-400">
            Nobody tagged yet — add tags or notes on a member's profile and they'll show up here.
        </div>

        <div v-else class="card divide-y divide-white/5">
            <div v-for="row in filtered" :key="row.member" class="flex items-center gap-3 px-4 py-3">
                <span
                    class="h-2.5 w-2.5 shrink-0 rounded-full"
                    :class="session.onlineFriendNumbers.has(row.member) ? 'bg-emerald-400' : 'bg-neutral-700'"
                    :title="session.onlineFriendNumbers.has(row.member) ? 'Online' : 'Offline'"
                />
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <RouterLink
                            :to="{ name: 'member', params: { viewer, member: row.member } }"
                            class="font-medium hover:underline"
                            :style="{ color: row.record?.labelColor || '#ffffff' }"
                            >
{{ nameOf(row) }}
</RouterLink
                        >
                        <span class="text-xs text-neutral-600">#{{ row.member }}</span>
                        <span
                            v-for="tag in row.note.tags"
                            :key="tag"
                            class="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            :class="tagClass(tag)"
                            >{{ tag }}</span
                        >
                    </div>
                    <p v-if="row.note.note" class="mt-0.5 truncate text-xs text-neutral-500">
                        {{ row.note.note }}
                    </p>
                </div>
                <div class="shrink-0 text-right text-xs text-neutral-500">
                    <div>Seen {{ formatDate(row.seen?.lastSeen) }}</div>
                    <div v-if="row.seen?.lastLocation">{{ row.seen.lastLocation }}</div>
                </div>
                <RouterLink
                    :to="{ name: 'beeps', params: { viewer }, query: { member: row.member } }"
                    class="btn shrink-0 px-2 py-0.5 text-xs"
                    >
Beep
</RouterLink
                >
            </div>
        </div>
    </div>
</template>
