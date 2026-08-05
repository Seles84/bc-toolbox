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
const globalPaused = ref(false);

async function loadPrivacy() {
    const stored = await chrome.storage.local.get('privacy');
    globalPaused.value = !!(stored.privacy as { capturePaused?: boolean } | undefined)?.capturePaused;
}

async function toggleGlobalPause() {
    const stored = await chrome.storage.local.get('privacy');
    const privacy = (stored.privacy as Record<string, unknown>) ?? {};
    globalPaused.value = !globalPaused.value;
    await chrome.storage.local.set({ privacy: { ...privacy, capturePaused: globalPaused.value } });
}

async function toggleTabPause(tab: TabStatus) {
    await api('tabs.setPaused', { tabId: tab.tabId, paused: !tab.capturePaused });
    tabs.value = await api('tabs.status', undefined);
}
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
    await loadPrivacy();
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
            <button
                class="mb-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm"
                :class="
                    globalPaused
                        ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                        : 'bg-surface-2 text-neutral-300 hover:bg-surface-3'
                "
                @click="toggleGlobalPause"
            >
                <span class="h-2 w-2 rounded-full" :class="globalPaused ? 'bg-amber-400' : 'bg-emerald-400'" />
                {{ globalPaused ? 'Capture paused — click to resume' : 'Capture active — click to pause' }}
            </button>
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
                                :class="
                                    tab.capturePaused || globalPaused
                                        ? 'bg-neutral-500'
                                        : tab.needsRefresh
                                          ? 'bg-amber-400'
                                          : 'bg-emerald-400'
                                "
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
                            <span v-if="tab.roomPrivate" class="text-amber-400/80">
                                · private, not recorded</span
                            >
                        </p>
                        <p v-if="tab.needsRefresh" class="mt-1 text-xs text-amber-400">
                            Refresh the game tab to update capture
                        </p>
                    </button>
                    <div class="border-t border-white/5 px-3 py-1.5">
                        <button
                            class="text-[11px]"
                            :class="
                                tab.capturePaused
                                    ? 'text-amber-300 hover:text-amber-200'
                                    : 'text-neutral-500 hover:text-white'
                            "
                            @click="toggleTabPause(tab)"
                        >
                            {{ tab.capturePaused ? 'Capture paused for this tab — resume' : 'Pause capture for this tab' }}
                        </button>
                    </div>

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
