/**
 * Session store: which of the player's characters the UI is browsing as
 * ("viewer"), the list of owned characters, and live game-tab status.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { liveQuery } from 'dexie';
import { db } from '@/shared/db';
import type { MemberRecord } from '@/shared/records';
import type { TabStatus } from '@/shared/protocol';
import { api } from '../api';

export const useSessionStore = defineStore('session', () => {
    const characters = ref<MemberRecord[]>([]);
    const viewer = ref<number | null>(null);
    const tabs = ref<TabStatus[]>([]);

    const viewerRecord = computed(
        () => characters.value.find((c) => c.memberNumber === viewer.value) ?? null,
    );

    const viewerName = computed(() => {
        const record = viewerRecord.value;
        return record ? record.nickname || record.name : null;
    });

    /** Is the currently selected character live in a game tab right now? */
    const viewerOnline = computed(() =>
        tabs.value.some((t) => t.memberNumber === viewer.value),
    );

    /** The selected character's online friends (empty when offline). */
    const onlineFriends = computed(
        () => tabs.value.find((t) => t.memberNumber === viewer.value)?.friends ?? [],
    );

    const onlineFriendNumbers = computed(
        () => new Set(onlineFriends.value.map((f) => f.memberNumber)),
    );

    // Live for the lifetime of the app — new characters appear on first login.
    liveQuery(() => db.members.where('isPlayer').equals(1).toArray()).subscribe({
        next: (rows) => {
            characters.value = rows;
        },
        error: (error) => console.error('[BCT] characters liveQuery error', error),
    });

    async function refreshTabs() {
        try {
            tabs.value = await api('tabs.status', undefined);
        } catch {
            tabs.value = [];
        }
    }

    function select(memberNumber: number) {
        viewer.value = memberNumber;
    }

    return {
        characters,
        viewer,
        viewerRecord,
        viewerName,
        viewerOnline,
        onlineFriends,
        onlineFriendNumbers,
        tabs,
        refreshTabs,
        select,
    };
});
