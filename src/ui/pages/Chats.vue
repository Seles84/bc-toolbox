<script setup lang="ts">
/**
 * Chat history for the selected character: either chronological room visits
 * grouped by play session, or every room aggregated with its visit history.
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { ChatChannelRecord, PlayerSessionRecord } from '@/shared/records';
import { useLiveQuery } from '../composables/useLiveQuery';

const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));

const view = ref<'sessions' | 'rooms'>('sessions');

interface SessionGroup {
    session: PlayerSessionRecord;
    channels: ChatChannelRecord[];
}

const groups = useLiveQuery<SessionGroup[]>(
    async () => {
        const sessions = await db.playerSessions
            .where('member')
            .equals(viewer.value)
            .reverse()
            .sortBy('started');
        const result: SessionGroup[] = [];
        for (const session of sessions) {
            const channels = await db.chatChannels
                .where('sessionId')
                .equals(session.sessionId)
                .reverse()
                .sortBy('entered');
            if (channels.length > 0) {
                result.push({ session, channels });
            }
        }
        return result;
    },
    [viewer],
    [],
);

interface RoomGroup {
    roomName: string;
    description?: string;
    /** Visits, most recent first */
    visits: ChatChannelRecord[];
    /** Distinct members seen across all visits */
    people: number;
    lastEntered: number;
    /** A visit is still open */
    active: boolean;
}

const rooms = computed<RoomGroup[]>(() => {
    const byName = new Map<string, { visits: ChatChannelRecord[]; people: Set<number> }>();
    for (const group of groups.value) {
        for (const channel of group.channels) {
            let room = byName.get(channel.roomName);
            if (!room) {
                room = { visits: [], people: new Set() };
                byName.set(channel.roomName, room);
            }
            room.visits.push(channel);
            for (const member of channel.memberNumbers ?? []) {
                room.people.add(member);
            }
        }
    }
    return [...byName.entries()]
        .map(([roomName, room]) => {
            const visits = [...room.visits].sort((a, b) => b.entered - a.entered);
            return {
                roomName,
                description: visits.find((v) => v.description)?.description,
                visits,
                people: room.people.size,
                lastEntered: visits[0]!.entered,
                active: visits.some((v) => v.left === 0),
            };
        })
        .sort((a, b) => b.lastEntered - a.lastEntered);
});

const expandedRoom = ref<string | null>(null);

function toggleRoom(roomName: string) {
    expandedRoom.value = expandedRoom.value === roomName ? null : roomName;
}

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h1 class="text-2xl font-semibold text-white">Chat history</h1>
            <div class="flex rounded-lg border border-white/10 bg-surface-2/40 p-0.5 text-xs">
                <button
                    class="rounded-md px-3 py-1"
                    :class="view === 'sessions' ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-neutral-200'"
                    @click="view = 'sessions'"
                >
                    Sessions
                </button>
                <button
                    class="rounded-md px-3 py-1"
                    :class="view === 'rooms' ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-neutral-200'"
                    @click="view = 'rooms'"
                >
                    Rooms
                </button>
            </div>
        </div>

        <div v-if="groups.length === 0" class="card mx-auto max-w-md p-8 text-center text-neutral-400">
            No chat sessions recorded for this character yet.
        </div>

        <!-- Chronological visits, grouped by play session -->
        <template v-else-if="view === 'sessions'">
            <div v-for="group in groups" :key="group.session.sessionId" class="mb-6">
                <h2 class="mb-2 text-sm font-medium text-neutral-400">
                    Session started {{ formatDate(group.session.started) }}
                    <span v-if="group.session.ended === 0" class="ml-1 text-emerald-400">· active</span>
                </h2>
                <div class="card divide-y divide-white/5">
                    <RouterLink
                        v-for="channel in group.channels"
                        :key="channel.id"
                        :to="{ name: 'chatroom', params: { viewer, channel: channel.id } }"
                        class="flex items-center gap-4 px-4 py-3 hover:bg-white/5"
                    >
                        <div class="min-w-0 flex-1">
                            <div class="truncate font-medium text-white">{{ channel.roomName }}</div>
                            <div v-if="channel.description" class="truncate text-sm text-neutral-500">
                                {{ channel.description }}
                            </div>
                        </div>
                        <div class="shrink-0 text-right text-xs text-neutral-500">
                            <div>{{ formatDate(channel.entered) }}</div>
                            <div>{{ channel.memberNumbers?.length ?? 0 }} members seen</div>
                        </div>
                    </RouterLink>
                </div>
            </div>
        </template>

        <!-- Every room, aggregated across sessions -->
        <div v-else class="card divide-y divide-white/5">
            <div v-for="room in rooms" :key="room.roomName">
                <button
                    class="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-white/5"
                    @click="toggleRoom(room.roomName)"
                >
                    <span
                        class="shrink-0 text-xs text-neutral-600 transition-transform"
                        :class="expandedRoom === room.roomName ? 'rotate-90' : ''"
                        >▶</span
                    >
                    <div class="min-w-0 flex-1">
                        <div class="truncate font-medium text-white">
                            {{ room.roomName }}
                            <span v-if="room.active" class="ml-1 text-xs text-emerald-400">· open</span>
                        </div>
                        <div v-if="room.description" class="truncate text-sm text-neutral-500">
                            {{ room.description }}
                        </div>
                    </div>
                    <div class="shrink-0 text-right text-xs text-neutral-500">
                        <div>
                            {{ room.visits.length }} {{ room.visits.length === 1 ? 'visit' : 'visits' }}
                            · {{ room.people }} {{ room.people === 1 ? 'person' : 'people' }} met
                        </div>
                        <div>last {{ formatDate(room.lastEntered) }}</div>
                    </div>
                </button>
                <div
                    v-if="expandedRoom === room.roomName"
                    class="border-t border-white/5 bg-surface-2/30"
                >
                    <RouterLink
                        v-for="visit in room.visits"
                        :key="visit.id"
                        :to="{ name: 'chatroom', params: { viewer, channel: visit.id } }"
                        class="flex items-center justify-between gap-4 px-10 py-2 text-sm hover:bg-white/5"
                    >
                        <span class="text-neutral-300">{{ formatDate(visit.entered) }}</span>
                        <span class="shrink-0 text-xs text-neutral-500">
                            {{ visit.memberNumbers?.length ?? 0 }} members seen
                            <span v-if="visit.left === 0" class="ml-1 text-emerald-400">· open</span>
                        </span>
                    </RouterLink>
                </div>
            </div>
        </div>
    </div>
</template>
