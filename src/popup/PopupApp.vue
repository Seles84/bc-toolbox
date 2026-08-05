<script setup lang="ts">
/**
 * Toolbar popup: per-tab capture status with a live roster of the current
 * room — quick jump to anyone's profile or beep conversation.
 */
import { computed, onMounted, ref } from 'vue';
import { db } from '@/shared/db';
import type { RosterMember, TabStatus } from '@/shared/protocol';
import { api } from '../ui/api';

const version = __BCT_VERSION__;
const tabs = ref<TabStatus[]>([]);
const rosters = ref(new Map<number, RosterMember[]>());
const characterCount = ref(0);
const loaded = ref(false);

const liveTabs = computed(() => tabs.value.filter((t) => t.memberNumber));

onMounted(async () => {
    try {
        tabs.value = await api('tabs.status', undefined);
    } catch {
        tabs.value = [];
    }
    characterCount.value = await db.members.where('isPlayer').equals(1).count();
    loaded.value = true;

    // Fetch each in-room tab's live roster in parallel.
    await Promise.all(
        liveTabs.value
            .filter((t) => t.roomName)
            .map(async (tab) => {
                try {
                    const result = await api('page.query', {
                        memberNumber: tab.memberNumber!,
                        query: { type: 'room-roster' },
                    });
                    if (result.success) {
                        rosters.value.set(
                            tab.memberNumber!,
                            (result.data as { members: RosterMember[] }).members,
                        );
                    }
                } catch {
                    // Roster is a nicety — the popup still works without it.
                }
            }),
    );
});

function open(path = '') {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`index.html${path}`) });
    window.close();
}
</script>

<template>
    <div class="w-96 p-3">
        <div class="mb-3 flex items-center gap-2">
            <img src="/bclub-logo.png" alt="" class="h-6 w-6 rounded" />
            <span class="font-semibold text-white">BC Toolbox</span>
            <button class="btn btn-accent ml-auto px-2.5 py-1 text-xs" @click="open()">
                Open toolbox
            </button>
        </div>

        <div v-if="!loaded" class="py-6 text-center text-sm text-neutral-500">Loading…</div>

        <template v-else>
            <div v-if="liveTabs.length === 0" class="card p-4 text-center text-sm text-neutral-400">
                No characters online.
                <p v-if="characterCount === 0" class="mt-1 text-xs text-neutral-600">
                    Log into the club with the extension enabled to get started.
                </p>
            </div>

            <div v-else class="space-y-2">
                <div v-for="tab in liveTabs" :key="tab.tabId" class="card overflow-hidden">
                    <button
                        class="block w-full p-3 text-left hover:bg-white/5"
                        @click="open(`#/c/${tab.memberNumber}`)"
                    >
                        <div class="flex items-center gap-2">
                            <span
                                class="h-2 w-2 shrink-0 rounded-full"
                                :class="tab.needsRefresh ? 'bg-amber-400' : 'bg-emerald-400'"
                            />
                            <span class="truncate text-sm font-medium text-white">
                                {{ tab.characterName ?? `#${tab.memberNumber}` }}
                            </span>
                            <span class="text-xs text-neutral-600">#{{ tab.memberNumber }}</span>
                            <span
                                v-if="tab.friends?.length"
                                class="ml-auto shrink-0 text-xs text-neutral-500"
                                :title="`${tab.friends.length} friends online`"
                            >
                                {{ tab.friends.length }} online
                            </span>
                        </div>
                        <p class="mt-1 truncate text-xs text-neutral-500">
                            {{ tab.roomName ? `In ${tab.roomName}` : 'Not in a room' }}
                        </p>
                        <p v-if="tab.needsRefresh" class="mt-1 text-xs text-amber-400">
                            Refresh the game tab to update capture
                        </p>
                    </button>

                    <ul
                        v-if="rosters.get(tab.memberNumber!)?.length"
                        class="border-t border-white/5 bg-surface-2/30"
                    >
                        <li
                            v-for="member in rosters.get(tab.memberNumber!)"
                            :key="member.memberNumber"
                            class="flex items-center gap-2 px-3 py-1.5"
                        >
                            <span
                                class="min-w-0 flex-1 truncate text-xs font-medium"
                                :style="{ color: member.labelColor || '#e5e5e5' }"
                            >
                                {{ member.nickname || member.name }}
                                <span v-if="member.isPlayer" class="text-neutral-600">(you)</span>
                            </span>
                            <template v-if="!member.isPlayer">
                                <button
                                    class="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-white/10 hover:text-white"
                                    title="View profile"
                                    @click="open(`#/c/${tab.memberNumber}/members/${member.memberNumber}`)"
                                >
                                    Profile
                                </button>
                                <button
                                    class="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-white/10 hover:text-white"
                                    title="Open beep conversation"
                                    @click="open(`#/c/${tab.memberNumber}/beeps?member=${member.memberNumber}`)"
                                >
                                    Beep
                                </button>
                            </template>
                        </li>
                    </ul>
                </div>
            </div>
        </template>

        <p class="mt-3 text-center text-[10px] text-neutral-700">BC Toolbox v{{ version }}</p>
    </div>
</template>
