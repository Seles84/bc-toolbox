<script setup lang="ts">
/**
 * Live browser of every public room currently on the server, fetched
 * through the game tab with the same search the club's own room list uses.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { LiveRoomInfo } from '@/shared/protocol';
import { api } from '../api';
import { useSessionStore } from '../stores/session';

const route = useRoute();
const session = useSessionStore();
const viewer = computed(() => Number(route.params.viewer));

const rooms = ref<LiveRoomInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const fetchedAt = ref<number | null>(null);

const filter = ref('');
const space = ref<'all' | 'X' | '' | 'M' | 'Asylum'>('all');
const hideFull = ref(false);

const SPACE_LABELS: Record<string, string> = {
    '': 'Female-only',
    X: 'Mixed',
    M: 'Male-only',
    Asylum: 'Asylum',
};

async function refresh() {
    if (loading.value || !session.viewerOnline) return;
    loading.value = true;
    error.value = null;
    try {
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'search-rooms' },
        });
        if (result.success) {
            rooms.value = (result.data as { rooms: LiveRoomInfo[] }).rooms;
            fetchedAt.value = Date.now();
        } else {
            error.value = result.error;
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

onMounted(() => void refresh());
watch(
    () => session.viewerOnline,
    (online) => {
        if (online && rooms.value.length === 0) void refresh();
    },
);

const filtered = computed(() => {
    const q = filter.value.trim().toLowerCase();
    return rooms.value
        .filter((room) => {
            if (space.value !== 'all' && room.space !== space.value) return false;
            if (hideFull.value && room.memberCount >= room.memberLimit) return false;
            if (!q) return true;
            return (
                room.name.toLowerCase().includes(q) ||
                room.creator.toLowerCase().includes(q) ||
                room.description.toLowerCase().includes(q)
            );
        })
        .sort((a, b) => b.memberCount - a.memberCount);
});

const population = computed(() => filtered.value.reduce((sum, r) => sum + r.memberCount, 0));

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center gap-3">
            <h1 class="text-2xl font-semibold text-white">Live rooms</h1>
            <button class="btn px-3 py-1 text-sm" :disabled="!session.viewerOnline || loading" @click="refresh">
                {{ loading ? 'Fetching…' : 'Refresh' }}
            </button>
            <span v-if="fetchedAt" class="text-xs text-neutral-500">
                as of {{ formatDate(fetchedAt) }}
            </span>
        </div>

        <div
            v-if="!session.viewerOnline"
            class="card mx-auto max-w-md p-8 text-center text-neutral-400"
        >
            Your character must be online to browse the club's rooms.
        </div>

        <p v-else-if="error" class="card mx-auto max-w-md p-8 text-center text-sm text-red-400">
            {{ error }}
        </p>

        <template v-else-if="rooms.length > 0">
            <div class="mb-4 flex flex-wrap items-center gap-3">
                <input v-model="filter" class="input w-64" placeholder="Filter by name, creator or description…" />
                <select v-model="space" class="input w-auto">
                    <option value="all">All spaces</option>
                    <option value="X">Mixed</option>
                    <option value="">Female-only</option>
                    <option value="M">Male-only</option>
                    <option value="Asylum">Asylum</option>
                </select>
                <label class="flex items-center gap-2 text-sm text-neutral-400">
                    <input v-model="hideFull" type="checkbox" class="accent-accent" />
                    Hide full rooms
                </label>
                <span class="ml-auto text-xs text-neutral-500">
                    {{ filtered.length }} {{ filtered.length === 1 ? 'room' : 'rooms' }}
                    · {{ population }} people in them
                </span>
            </div>

            <div class="card divide-y divide-white/5">
                <div v-for="room in filtered" :key="`${room.space}:${room.name}`" class="px-4 py-3">
                    <div class="flex items-baseline gap-2">
                        <span class="truncate font-medium text-white">{{ room.name }}</span>
                        <span
                            class="shrink-0 text-sm"
                            :class="room.memberCount >= room.memberLimit ? 'text-amber-400' : 'text-neutral-400'"
                        >
                            {{ room.memberCount }}/{{ room.memberLimit }}
                        </span>
                        <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-neutral-400">
                            {{ SPACE_LABELS[room.space] ?? room.space }}
                        </span>
                        <span
                            v-if="room.language && room.language !== 'EN'"
                            class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-neutral-400"
                        >
                            {{ room.language }}
                        </span>
                        <span
                            v-if="room.game"
                            class="shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-300"
                        >
                            {{ room.game }}
                        </span>
                        <span
                            v-if="room.canJoin === false"
                            class="shrink-0 text-[11px] text-neutral-600"
                            title="Locked, restricted or in another space"
                            >no entry</span
                        >
                        <span class="ml-auto shrink-0 text-xs text-neutral-500">
                            by {{ room.creator }} <span class="text-neutral-600">#{{ room.creatorMemberNumber }}</span>
                        </span>
                    </div>
                    <p v-if="room.description" class="mt-0.5 truncate text-sm text-neutral-500">
                        {{ room.description }}
                    </p>
                    <p v-if="room.friends.length" class="mt-1 text-xs text-emerald-400">
                        Friends here:
                        <template v-for="(friend, index) in room.friends" :key="friend.memberNumber">
                            <template v-if="index > 0">, </template>
                            <RouterLink
                                :to="{ name: 'member', params: { viewer, member: friend.memberNumber } }"
                                class="hover:underline"
                                >
{{ friend.name }}
</RouterLink
                            >
                        </template>
                    </p>
                </div>
            </div>
        </template>

        <div
            v-else-if="!loading"
            class="card mx-auto max-w-md p-8 text-center text-neutral-400"
        >
            No rooms fetched yet — hit Refresh to ask the club.
        </div>
    </div>
</template>
