<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { ChatChannelRecord, ChatLogRecord, MemberRecord } from '@/shared/records';
import ChatLine from '../components/ChatLine.vue';
import { useLiveQuery } from '../composables/useLiveQuery';
import { downloadText, roomTranscript, safeFilename } from '../utils/transcript';

const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));
const channelId = computed(() => Number(route.params.channel));
const showWhispers = ref(true);

interface RoomData {
    channel: ChatChannelRecord | null;
    lines: ChatLogRecord[];
    members: Map<number, MemberRecord>;
}

const bookmarkedIds = useLiveQuery(
    async () =>
        new Set(
            (await db.bookmarks.where('viewer').equals(viewer.value).toArray()).map((b) => b.chatId),
        ),
    [viewer],
    new Set<number>(),
);

async function toggleBookmark(chatId?: number) {
    if (chatId === undefined) return;
    const existing = await db.bookmarks
        .where('[viewer+chatId]')
        .equals([viewer.value, chatId])
        .first();
    if (existing?.id !== undefined) {
        await db.bookmarks.delete(existing.id);
    } else {
        await db.bookmarks.add({ viewer: viewer.value, chatId, created: Date.now() });
    }
}

const room = useLiveQuery<RoomData>(
    async () => {
        const channel = (await db.chatChannels.get(channelId.value)) ?? null;
        const lines = await db.chat.where('channelId').equals(channelId.value).sortBy('created');

        // Participants = everyone the room sync saw + everyone who spoke.
        const ids = new Set<number>(channel?.memberNumbers ?? []);
        for (const line of lines) {
            ids.add(line.sender);
            if (line.target) ids.add(line.target);
        }
        const records = await db.members.bulkGet([...ids]);
        const members = new Map(
            records.filter((r): r is MemberRecord => !!r).map((r) => [r.memberNumber, r]),
        );
        return { channel, lines, members };
    },
    [channelId],
    { channel: null, lines: [], members: new Map() },
);

const channel = computed(() => room.value.channel);
const isLive = computed(() => channel.value?.left === 0);

const visibleLines = computed(() =>
    showWhispers.value ? room.value.lines : room.value.lines.filter((l) => l.type !== 'Whisper'),
);

const participants = computed(() =>
    [...room.value.members.values()].sort((a, b) =>
        (a.nickname || a.name).localeCompare(b.nickname || b.name),
    ),
);

// Stick to the bottom of the log while new lines stream in, unless the user
// has scrolled up to read history.
const logContainer = ref<HTMLDivElement>();

watch(
    () => visibleLines.value.length,
    async (_, oldLength) => {
        const el = logContainer.value;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (nearBottom || oldLength === 0) {
            await nextTick();
            el.scrollTop = el.scrollHeight;
        }
    },
);

function exportLog() {
    const c = channel.value;
    if (!c) return;
    const header = `${c.roomName} — entered ${new Date(c.entered).toLocaleString()}`;
    downloadText(
        `${safeFilename(c.roomName)}-${new Date(c.entered).toISOString().slice(0, 10)}.txt`,
        roomTranscript(header, visibleLines.value, room.value.members, viewer.value),
    );
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
</script>

<template>
    <div v-if="channel">
        <div class="mb-4 flex flex-wrap items-center gap-4">
            <div>
                <h1 class="flex items-center gap-2.5 text-2xl font-semibold text-white">
                    {{ channel.roomName }}
                    <span
                        v-if="isLive"
                        class="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300"
                        >live</span
                    >
                </h1>
                <p class="text-sm text-neutral-500">Entered {{ formatDate(channel.entered) }}</p>
            </div>
            <div class="ml-auto flex items-center gap-3">
                <label class="flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                    <input v-model="showWhispers" type="checkbox" class="accent-accent" />
                    Show whispers
                </label>
                <button class="btn" @click="exportLog">Export</button>
            </div>
        </div>

        <div class="flex flex-col gap-4 lg:flex-row">
            <div
                ref="logContainer"
                class="card max-h-[75vh] min-w-0 flex-1 overflow-y-auto scroll-smooth p-4"
            >
                <p v-if="visibleLines.length === 0" class="text-sm text-neutral-500">
                    No messages recorded in this room.
                </p>
                <div
                    v-for="line in visibleLines"
                    :key="line.id"
                    class="group flex gap-3 rounded px-1 py-1 hover:bg-white/[.03]"
                >
                    <span
                        class="w-16 shrink-0 pt-0.5 text-right font-mono text-xs whitespace-nowrap text-neutral-600"
                    >
                        {{ formatTime(line.created) }}
                    </span>
                    <ChatLine :line="line" :members="room.members" :viewer="viewer" class="min-w-0 flex-1" />
                    <button
                        class="shrink-0 self-start px-1 text-sm leading-5"
                        :class="
                            bookmarkedIds.has(line.id!)
                                ? 'text-amber-300'
                                : 'text-neutral-600 opacity-0 group-hover:opacity-100 hover:text-amber-300'
                        "
                        :title="bookmarkedIds.has(line.id!) ? 'Remove bookmark' : 'Bookmark this line'"
                        @click="toggleBookmark(line.id)"
                    >
                        {{ bookmarkedIds.has(line.id!) ? '★' : '☆' }}
                    </button>
                </div>
            </div>

            <aside class="card h-fit w-full p-4 lg:w-64 lg:shrink-0">
                <h2 class="mb-3 text-sm font-semibold text-neutral-400">
                    Participants ({{ participants.length }})
                </h2>
                <ul class="space-y-1.5">
                    <li v-for="participant in participants" :key="participant.memberNumber">
                        <RouterLink
                            :to="{
                                name: 'member',
                                params: { viewer, member: participant.memberNumber },
                            }"
                            class="block truncate text-sm hover:underline"
                            :style="{ color: participant.labelColor || '#e5e5e5' }"
                        >
                            {{ participant.nickname || participant.name }}
                            <span class="text-xs text-neutral-600">#{{ participant.memberNumber }}</span>
                        </RouterLink>
                    </li>
                </ul>
            </aside>
        </div>
    </div>
</template>
