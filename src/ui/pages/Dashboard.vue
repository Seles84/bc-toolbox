<script setup lang="ts">
/**
 * Landing page for a selected character: live status, online friends,
 * recent sessions, and recently met members at a glance.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { ChatChannelRecord, MemberRecord } from '@/shared/records';
import { useLiveQuery } from '../composables/useLiveQuery';
import { useSessionStore } from '../stores/session';

const route = useRoute();
const session = useSessionStore();
const viewer = computed(() => Number(route.params.viewer));

const tab = computed(() => session.tabs.find((t) => t.memberNumber === viewer.value) ?? null);

interface RecentSession {
    started: number;
    ended: number;
    channels: ChatChannelRecord[];
}

const data = useLiveQuery(
    async () => {
        const record = (await db.members.get(viewer.value)) ?? null;

        const sessions = await db.playerSessions
            .where('member')
            .equals(viewer.value)
            .reverse()
            .sortBy('started');
        const recentSessions: RecentSession[] = [];
        for (const s of sessions.slice(0, 3)) {
            recentSessions.push({
                started: s.started,
                ended: s.ended,
                channels: await db.chatChannels
                    .where('sessionId')
                    .equals(s.sessionId)
                    .reverse()
                    .sortBy('entered'),
            });
        }

        const seenRows = await db.memberSeen.where('viewer').equals(viewer.value).toArray();
        seenRows.sort((a, b) => b.lastSeen - a.lastSeen);
        const recentIds = seenRows.slice(0, 8).map((s) => s.member);
        const recentMembers = (await db.members.bulkGet(recentIds)).filter(
            (m): m is MemberRecord => !!m,
        );

        return { record, recentSessions, recentMembers };
    },
    [viewer],
    {
        record: null as MemberRecord | null,
        recentSessions: [] as RecentSession[],
        recentMembers: [] as MemberRecord[],
    },
);

const onlineFriends = computed(() => session.onlineFriends.slice(0, 6));

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
</script>

<template>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <!-- Character / live status -->
        <div class="card p-5">
            <div class="flex items-start gap-4">
                <div class="flex h-40 w-24 shrink-0 items-center justify-center rounded bg-surface-2/60">
                    <img
                        v-if="data.record?.appearanceImage"
                        :src="data.record.appearanceImage"
                        alt=""
                        class="h-full object-contain"
                    />
                    <span v-else class="text-2xl text-neutral-600">?</span>
                </div>
                <div class="min-w-0">
                    <h1
                        class="truncate text-xl font-semibold"
                        :style="{ color: data.record?.labelColor || '#ffffff' }"
                    >
                        {{ data.record ? data.record.nickname || data.record.name : `#${viewer}` }}
                    </h1>
                    <p class="mb-3 text-xs text-neutral-500">#{{ viewer }}</p>

                    <div class="flex items-center gap-2 text-sm">
                        <span
                            class="h-2.5 w-2.5 rounded-full"
                            :class="tab ? 'bg-emerald-400' : 'bg-neutral-600'"
                        />
                        <span class="text-neutral-300">{{ tab ? 'Online' : 'Offline' }}</span>
                    </div>
                    <p v-if="tab?.roomName" class="mt-1 text-sm text-neutral-400">
                        In
                        <RouterLink
                            v-if="tab.channelId"
                            :to="{ name: 'chatroom', params: { viewer, channel: tab.channelId } }"
                            class="text-accent-soft hover:underline"
                            >
{{ tab.roomName }}
</RouterLink
                        >
                        <template v-else>{{ tab.roomName }}</template>
                    </p>
                    <p v-if="tab?.needsRefresh" class="mt-2 text-xs text-amber-400">
                        Game tab needs a refresh to update capture.
                    </p>
                </div>
            </div>
        </div>

        <!-- Online friends -->
        <div class="card p-5">
            <div class="mb-3 flex items-baseline justify-between">
                <h2 class="font-medium text-white">Online friends</h2>
                <RouterLink
                    :to="{ name: 'friends', params: { viewer } }"
                    class="text-xs text-accent-soft hover:underline"
                    >
all friends
</RouterLink
                >
            </div>
            <p v-if="!tab" class="text-sm text-neutral-500">Character offline — no live data.</p>
            <p v-else-if="onlineFriends.length === 0" class="text-sm text-neutral-500">
                No friends online right now.
            </p>
            <ul v-else class="space-y-1.5">
                <li
                    v-for="friend in onlineFriends"
                    :key="friend.memberNumber"
                    class="flex items-center gap-2 text-sm"
                >
                    <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <RouterLink
                        :to="{ name: 'member', params: { viewer, member: friend.memberNumber } }"
                        class="truncate text-neutral-200 hover:underline"
                        >
{{ friend.name }}
</RouterLink
                    >
                    <span class="ml-auto shrink-0 truncate text-xs text-neutral-500">
                        {{ friend.private ? 'Private' : (friend.chatRoomName ?? 'No room') }}
                    </span>
                </li>
            </ul>
        </div>

        <!-- Recent sessions -->
        <div class="card p-5">
            <div class="mb-3 flex items-baseline justify-between">
                <h2 class="font-medium text-white">Recent sessions</h2>
                <RouterLink
                    :to="{ name: 'chats', params: { viewer } }"
                    class="text-xs text-accent-soft hover:underline"
                    >
all chats
</RouterLink
                >
            </div>
            <p v-if="data.recentSessions.length === 0" class="text-sm text-neutral-500">
                No sessions recorded yet.
            </p>
            <div v-for="(recent, index) in data.recentSessions" :key="index" class="mb-3 last:mb-0">
                <p class="mb-1 text-xs text-neutral-500">
                    {{ formatDate(recent.started) }}
                    <span v-if="recent.ended === 0" class="text-emerald-400">· active</span>
                </p>
                <ul class="space-y-0.5">
                    <li v-for="channel in recent.channels.slice(0, 3)" :key="channel.id" class="truncate text-sm">
                        <RouterLink
                            :to="{ name: 'chatroom', params: { viewer, channel: channel.id } }"
                            class="text-neutral-300 hover:underline"
                            >
{{ channel.roomName }}
</RouterLink
                        >
                    </li>
                </ul>
            </div>
        </div>

        <!-- Recently met -->
        <div class="card p-5 lg:col-span-3">
            <div class="mb-3 flex items-baseline justify-between">
                <h2 class="font-medium text-white">Recently met</h2>
                <RouterLink
                    :to="{ name: 'members', params: { viewer } }"
                    class="text-xs text-accent-soft hover:underline"
                    >
all members
</RouterLink
                >
            </div>
            <p v-if="data.recentMembers.length === 0" class="text-sm text-neutral-500">
                Nobody met yet — join a room and people will appear here.
            </p>
            <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                <RouterLink
                    v-for="member in data.recentMembers"
                    :key="member.memberNumber"
                    :to="{ name: 'member', params: { viewer, member: member.memberNumber } }"
                    class="group rounded-lg border border-white/5 bg-surface-2/40 p-2 text-center hover:border-accent-soft/40"
                >
                    <div class="mx-auto flex h-24 items-center justify-center">
                        <img
                            v-if="member.appearanceImage"
                            :src="member.appearanceImage"
                            alt=""
                            class="h-full object-contain"
                        />
                        <span v-else class="text-xl text-neutral-600">?</span>
                    </div>
                    <div
                        class="mt-1 truncate text-xs font-medium"
                        :style="{ color: member.labelColor || '#e5e5e5' }"
                    >
                        {{ member.nickname || member.name }}
                    </div>
                </RouterLink>
            </div>
        </div>
    </div>
</template>
