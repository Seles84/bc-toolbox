<script setup lang="ts">
/**
 * Friend list for the selected character: everyone from their captured
 * friends list, merged with live online status (room, relationship type)
 * polled from the game. Online friends first.
 */
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { OnlineFriendInfo } from '@/shared/protocol';
import { useLiveQuery } from '../composables/useLiveQuery';
import { useSessionStore } from '../stores/session';

const route = useRoute();
const session = useSessionStore();
const viewer = computed(() => Number(route.params.viewer));

interface FriendRow {
    memberNumber: number;
    name: string;
    online: OnlineFriendInfo | null;
    captured: boolean;
}

const friendData = useLiveQuery(
    async () => {
        const record = await db.members.get(viewer.value);
        const names = new Map<number, string>();
        for (const [key, name] of Object.entries(record?.friends ?? {})) {
            const memberNumber = Number(key);
            if (Number.isFinite(memberNumber)) {
                names.set(memberNumber, name);
            }
        }
        const captured = new Set<number>();
        await db.members.each((m) => {
            if (names.has(m.memberNumber)) captured.add(m.memberNumber);
        });
        return { names, captured };
    },
    [viewer],
    { names: new Map<number, string>(), captured: new Set<number>() },
);

const friendNames = computed(() => friendData.value.names);
const capturedNumbers = computed(() => friendData.value.captured);

onMounted(() => void session.refreshTabs());

const rows = computed<FriendRow[]>(() => {
    const online = new Map(session.onlineFriends.map((f) => [f.memberNumber, f]));
    const all = new Map<number, FriendRow>();

    for (const [memberNumber, name] of friendNames.value) {
        all.set(memberNumber, {
            memberNumber,
            name,
            online: online.get(memberNumber) ?? null,
            captured: capturedNumbers.value.has(memberNumber),
        });
    }
    // Online people the server reports that the captured list doesn't know
    // (owner/subs/lovers also arrive via the OnlineFriends query).
    for (const friend of session.onlineFriends) {
        if (!all.has(friend.memberNumber)) {
            all.set(friend.memberNumber, {
                memberNumber: friend.memberNumber,
                name: friend.name,
                online: friend,
                captured: capturedNumbers.value.has(friend.memberNumber),
            });
        }
    }

    return [...all.values()].sort(
        (a, b) =>
            Number(!!b.online) - Number(!!a.online) || a.name.localeCompare(b.name),
    );
});

const onlineCount = computed(() => rows.value.filter((r) => r.online).length);

function location(friend: OnlineFriendInfo): string {
    if (friend.private) return 'Private room';
    if (!friend.chatRoomName) return 'Online (not in a room)';
    const occupancy =
        friend.chatRoomMemberCount !== undefined && friend.chatRoomLimit !== undefined
            ? ` (${friend.chatRoomMemberCount}/${friend.chatRoomLimit})`
            : '';
    return `${friend.chatRoomName}${occupancy}`;
}

const TYPE_BADGES: Record<string, { label: string; class: string }> = {
    Submissive: { label: 'Sub', class: 'bg-purple-500/20 text-purple-300' },
    Lover: { label: 'Lover', class: 'bg-rose-500/20 text-rose-300' },
};
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center gap-4">
            <h1 class="text-2xl font-semibold text-white">Friends</h1>
            <span class="text-sm text-neutral-500">
                {{ onlineCount }} online · {{ rows.length }} total
            </span>
            <span v-if="!session.viewerOnline" class="ml-auto text-sm text-amber-400">
                Character offline — live status unavailable
            </span>
        </div>

        <div v-if="rows.length === 0" class="card mx-auto max-w-md p-8 text-center text-neutral-400">
            No friends captured for this character yet — the list is read at login.
        </div>

        <div v-else class="card divide-y divide-white/5">
            <div
                v-for="row in rows"
                :key="row.memberNumber"
                class="flex items-center gap-3 px-4 py-2.5"
            >
                <span
                    class="h-2.5 w-2.5 shrink-0 rounded-full"
                    :class="row.online ? 'bg-emerald-400' : 'bg-neutral-700'"
                    :title="row.online ? 'Online' : 'Offline'"
                />
                <div class="min-w-0 flex-1">
                    <RouterLink
                        v-if="row.captured"
                        :to="{ name: 'member', params: { viewer, member: row.memberNumber } }"
                        class="font-medium text-white hover:underline"
                        >
{{ row.name }}
</RouterLink
                    >
                    <span v-else class="font-medium text-neutral-300">{{ row.name }}</span>
                    <span class="ml-2 text-xs text-neutral-600">#{{ row.memberNumber }}</span>
                    <span
                        v-if="row.online && TYPE_BADGES[row.online.type]"
                        class="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium"
                        :class="TYPE_BADGES[row.online.type]!.class"
                        >{{ TYPE_BADGES[row.online.type]!.label }}</span
                    >
                </div>
                <div class="shrink-0 text-right text-sm text-neutral-500">
                    {{ row.online ? location(row.online) : 'Offline' }}
                </div>
            </div>
        </div>
    </div>
</template>
