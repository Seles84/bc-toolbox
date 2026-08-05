<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { ChatChannelRecord, PlayerSessionRecord } from '@/shared/records';
import { useLiveQuery } from '../composables/useLiveQuery';

const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));

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

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
</script>

<template>
    <div>
        <h1 class="mb-5 text-2xl font-semibold text-white">Chat history</h1>

        <div v-if="groups.length === 0" class="card mx-auto max-w-md p-8 text-center text-neutral-400">
            No chat sessions recorded for this character yet.
        </div>

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
    </div>
</template>
