<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { MemberRecord, MemberSeenRecord } from '@/shared/records';
import { useLiveQuery } from '../composables/useLiveQuery';
import { useSessionStore } from '../stores/session';

const PAGE_SIZE = 48;

const session = useSessionStore();
const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));

const search = ref('');
const query = ref('');
const page = ref(1);

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
}

const data = useLiveQuery<MembersData>(
    async () => {
        let collection = db.members.orderBy('name');
        const q = query.value;
        if (q) {
            collection = collection.filter(
                (m) =>
                    m.name.toLowerCase().includes(q) ||
                    (m.nickname ?? '').toLowerCase().includes(q) ||
                    String(m.memberNumber).includes(q),
            );
        }
        const total = await collection.clone().count();
        const rows = await collection
            .offset((page.value - 1) * PAGE_SIZE)
            .limit(PAGE_SIZE)
            .toArray();
        const seenRows = await db.memberSeen.where('viewer').equals(viewer.value).toArray();
        return { rows, total, seen: new Map(seenRows.map((s) => [s.member, s])) };
    },
    [query, page, viewer],
    { rows: [], total: 0, seen: new Map() },
);

const pages = computed(() => Math.max(1, Math.ceil(data.value.total / PAGE_SIZE)));

watch(pages, (value) => {
    if (page.value > value) page.value = 1;
});

function formatDate(timestamp?: number): string {
    return timestamp ? new Date(timestamp).toLocaleDateString() : '—';
}
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center gap-4">
            <h1 class="text-2xl font-semibold text-white">Members</h1>
            <span class="text-sm text-neutral-500">{{ data.total }} known</span>
            <input v-model="search" class="input ml-auto max-w-xs" placeholder="Search name or ID…" />
        </div>

        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <RouterLink
                v-for="member in data.rows"
                :key="member.memberNumber"
                :to="{ name: 'member', params: { viewer, member: member.memberNumber } }"
                class="card group overflow-hidden transition-transform hover:-translate-y-0.5 hover:border-accent-soft/40"
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
