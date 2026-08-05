<script setup lang="ts">
/**
 * Global chat search for the selected character: scans every line recorded in
 * their rooms, newest first, with type and date filters.
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import { CHAT_TYPES, type ChatChannelRecord, type ChatLogRecord, type MemberRecord } from '@/shared/records';
import ChatLine from '../components/ChatLine.vue';

const LIMIT = 200;

const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));

const text = ref('');
const typeFilter = ref('');
const dateFrom = ref('');
const dateTo = ref('');

const searching = ref(false);
const searched = ref(false);

interface SearchHit {
    line: ChatLogRecord;
    channel: ChatChannelRecord | undefined;
}

const hits = ref<SearchHit[]>([]);
const members = ref(new Map<number, MemberRecord>());

async function runSearch() {
    searching.value = true;
    try {
        // Scope to rooms this character was in.
        const sessions = await db.playerSessions.where('member').equals(viewer.value).toArray();
        const sessionIds = new Set(sessions.map((s) => s.sessionId));
        const channels = await db.chatChannels
            .filter((c) => sessionIds.has(c.sessionId))
            .toArray();
        const channelById = new Map(channels.map((c) => [c.id!, c]));

        const q = text.value.trim().toLowerCase();
        const from = dateFrom.value ? new Date(dateFrom.value).getTime() : 0;
        const to = dateTo.value ? new Date(dateTo.value).getTime() + 86_400_000 : Infinity;

        const lines = await db.chat
            .orderBy('created')
            .reverse()
            .filter((line) => {
                if (!channelById.has(line.channelId)) return false;
                if (typeFilter.value && line.type !== typeFilter.value) return false;
                if (line.created < from || line.created >= to) return false;
                if (!q) return true;
                return (
                    line.message.toLowerCase().includes(q) ||
                    (line.renderedText ?? '').toLowerCase().includes(q) ||
                    (line.senderName ?? '').toLowerCase().includes(q)
                );
            })
            .limit(LIMIT)
            .toArray();

        hits.value = lines.map((line) => ({ line, channel: channelById.get(line.channelId) }));

        const senderIds = [...new Set(lines.flatMap((l) => [l.sender, l.target ?? 0]))].filter(Boolean);
        const records = await db.members.bulkGet(senderIds);
        members.value = new Map(
            records.filter((r): r is MemberRecord => !!r).map((r) => [r.memberNumber, r]),
        );
        searched.value = true;
    } finally {
        searching.value = false;
    }
}

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
</script>

<template>
    <div>
        <h1 class="mb-5 text-2xl font-semibold text-white">Search chat</h1>

        <form class="card mb-5 flex flex-wrap items-end gap-3 p-4" @submit.prevent="runSearch">
            <label class="min-w-52 flex-1">
                <span class="mb-1 block text-xs text-neutral-500">Text</span>
                <input v-model="text" class="input" placeholder="Search messages and names…" />
            </label>
            <label>
                <span class="mb-1 block text-xs text-neutral-500">Type</span>
                <select v-model="typeFilter" class="input w-auto">
                    <option value="">Any</option>
                    <option v-for="chatType in CHAT_TYPES" :key="chatType" :value="chatType">
                        {{ chatType }}
                    </option>
                </select>
            </label>
            <label>
                <span class="mb-1 block text-xs text-neutral-500">From</span>
                <input v-model="dateFrom" type="date" class="input w-auto" />
            </label>
            <label>
                <span class="mb-1 block text-xs text-neutral-500">To</span>
                <input v-model="dateTo" type="date" class="input w-auto" />
            </label>
            <button type="submit" class="btn btn-accent" :disabled="searching">
                {{ searching ? 'Searching…' : 'Search' }}
            </button>
        </form>

        <p v-if="searched && hits.length === 0" class="card mx-auto max-w-md p-8 text-center text-neutral-400">
            No matching messages.
        </p>

        <div v-else-if="hits.length" class="card divide-y divide-white/5">
            <p v-if="hits.length >= LIMIT" class="px-4 py-2 text-xs text-amber-400">
                Showing the {{ LIMIT }} most recent matches — narrow the filters for older ones.
            </p>
            <div v-for="hit in hits" :key="hit.line.id" class="px-4 py-2">
                <div class="mb-0.5 flex items-baseline gap-2 text-xs text-neutral-600">
                    <span>{{ formatDate(hit.line.created) }}</span>
                    <RouterLink
                        v-if="hit.channel"
                        :to="{ name: 'chatroom', params: { viewer, channel: hit.channel.id } }"
                        class="text-accent-soft/80 hover:underline"
                        >
{{ hit.channel.roomName }}
</RouterLink
                    >
                </div>
                <ChatLine :line="hit.line" :members="members" :viewer="viewer" />
            </div>
        </div>
    </div>
</template>
