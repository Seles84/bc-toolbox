<script setup lang="ts">
/** Starred chat lines for the selected character, newest first. */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { BookmarkRecord, ChatChannelRecord, ChatLogRecord, MemberRecord } from '@/shared/records';
import ChatLine from '../components/ChatLine.vue';
import { useLiveQuery } from '../composables/useLiveQuery';

const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));

interface BookmarkedLine {
    bookmark: BookmarkRecord;
    line: ChatLogRecord;
    channel: ChatChannelRecord | undefined;
}

const data = useLiveQuery(
    async () => {
        const bookmarks = await db.bookmarks.where('viewer').equals(viewer.value).reverse().sortBy('created');
        const lines = await db.chat.bulkGet(bookmarks.map((b) => b.chatId));
        const channelIds = [...new Set(lines.filter((l) => !!l).map((l) => l!.channelId))];
        const channels = await db.chatChannels.bulkGet(channelIds);
        const channelById = new Map(channels.filter((c) => !!c).map((c) => [c!.id!, c!]));

        const rows: BookmarkedLine[] = [];
        const memberIds = new Set<number>();
        bookmarks.forEach((bookmark, index) => {
            const line = lines[index];
            if (!line) return; // the line was pruned
            memberIds.add(line.sender);
            if (line.target) memberIds.add(line.target);
            rows.push({ bookmark, line, channel: channelById.get(line.channelId) });
        });
        const records = await db.members.bulkGet([...memberIds]);
        const members = new Map(
            records.filter((r): r is MemberRecord => !!r).map((r) => [r.memberNumber, r]),
        );
        return { rows, members };
    },
    [viewer],
    { rows: [] as BookmarkedLine[], members: new Map<number, MemberRecord>() },
);

async function remove(bookmark: BookmarkRecord) {
    if (bookmark.id !== undefined) {
        await db.bookmarks.delete(bookmark.id);
    }
}

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
</script>

<template>
    <div>
        <h1 class="mb-5 text-2xl font-semibold text-white">Bookmarks</h1>

        <div v-if="data.rows.length === 0" class="card mx-auto max-w-md p-8 text-center text-neutral-400">
            No bookmarked messages — hover a line in any room log and click the star.
        </div>

        <div v-else class="card divide-y divide-white/5">
            <div v-for="row in data.rows" :key="row.bookmark.id" class="group flex gap-3 px-4 py-2">
                <div class="min-w-0 flex-1">
                    <div class="mb-0.5 flex items-baseline gap-2 text-xs text-neutral-600">
                        <span>{{ formatDate(row.line.created) }}</span>
                        <RouterLink
                            v-if="row.channel"
                            :to="{ name: 'chatroom', params: { viewer, channel: row.channel.id } }"
                            class="text-accent-soft/80 hover:underline"
                            >
{{ row.channel.roomName }}
</RouterLink
                        >
                    </div>
                    <ChatLine :line="row.line" :members="data.members" :viewer="viewer" />
                </div>
                <button
                    class="shrink-0 self-start px-1 text-sm text-amber-300 hover:text-amber-200"
                    title="Remove bookmark"
                    @click="remove(row.bookmark)"
                >
                    ★
                </button>
            </div>
        </div>
    </div>
</template>
