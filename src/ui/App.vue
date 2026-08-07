<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import NavDropdown from './components/NavDropdown.vue';
import { useCheatsStore } from './stores/cheats';
import { useSessionStore } from './stores/session';

const session = useSessionStore();
const cheats = useCheatsStore();
const route = useRoute();

const peopleItems = [
    { name: 'members', label: 'Members', match: ['member'] },
    { name: 'friends', label: 'Friends' },
    { name: 'watchlist', label: 'Watchlist' },
];
const messageItems = [
    { name: 'chats', label: 'Chats', match: ['chatroom'] },
    { name: 'liverooms', label: 'Live rooms' },
    { name: 'beeps', label: 'Beeps' },
    { name: 'bookmarks', label: 'Bookmarks' },
];
const outfitItems = [
    { name: 'wardrobe', label: 'Wardrobe' },
    { name: 'crafts', label: 'Crafts' },
];

const capturePaused = ref(false);
async function loadPrivacy() {
    const stored = await chrome.storage.local.get('privacy');
    capturePaused.value = !!(stored.privacy as { capturePaused?: boolean } | undefined)
        ?.capturePaused;
}
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.privacy) {
        capturePaused.value = !!(changes.privacy.newValue as { capturePaused?: boolean } | undefined)
            ?.capturePaused;
    }
});

// Keep the selected character in sync with the /c/:viewer route segment.
watch(
    () => route.params.viewer,
    (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            session.select(parsed);
        }
    },
    { immediate: true },
);

let poll: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    void session.refreshTabs();
    void loadPrivacy();
    poll = setInterval(() => void session.refreshTabs(), 15_000);
});
onUnmounted(() => clearInterval(poll));
</script>

<template>
    <div class="min-h-screen flex flex-col">
        <header class="sticky top-0 z-20 border-b border-white/10 bg-surface-1/95 backdrop-blur">
            <div class="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
                <RouterLink to="/" class="flex items-center gap-2.5">
                    <img src="/bclub-logo.png" alt="" class="h-8 w-8 rounded" />
                    <span class="text-lg font-semibold tracking-tight text-white">BC Toolbox</span>
                </RouterLink>

                <nav v-if="session.viewer" class="flex items-center gap-1 text-sm">
                    <RouterLink
                        :to="{ name: 'dashboard', params: { viewer: session.viewer } }"
                        class="rounded-md px-3 py-1.5 text-neutral-400 hover:text-white hover:bg-white/5"
                        exact-active-class="!text-white bg-white/10"
                    >
                        Overview
                    </RouterLink>
                    <NavDropdown label="People" :items="peopleItems" :viewer="session.viewer" />
                    <NavDropdown label="Messages" :items="messageItems" :viewer="session.viewer" />
                    <NavDropdown label="Outfits" :items="outfitItems" :viewer="session.viewer" />
                    <RouterLink
                        :to="{ name: 'search', params: { viewer: session.viewer } }"
                        class="rounded-md px-3 py-1.5 text-neutral-400 hover:text-white hover:bg-white/5"
                        active-class="!text-white bg-white/10"
                    >
                        Search
                    </RouterLink>
                    <RouterLink
                        v-if="cheats.enabled"
                        :to="{ name: 'cheats', params: { viewer: session.viewer } }"
                        class="rounded-md px-3 py-1.5 text-neutral-400 hover:text-white hover:bg-white/5"
                        active-class="!text-white bg-white/10"
                    >
                        Cheats
                    </RouterLink>
                </nav>

                <div class="ml-auto flex items-center gap-3">
                    <RouterLink
                        v-if="session.viewerName"
                        :to="{ name: 'dashboard', params: { viewer: session.viewer } }"
                        class="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-sm hover:bg-surface-3"
                    >
                        <span
                            class="h-2 w-2 rounded-full"
                            :class="session.viewerOnline ? 'bg-emerald-400' : 'bg-neutral-600'"
                            :title="session.viewerOnline ? 'Online in a game tab' : 'Offline'"
                        />
                        <span class="text-neutral-200">{{ session.viewerName }}</span>
                        <span class="text-neutral-500">#{{ session.viewer }}</span>
                    </RouterLink>
                    <RouterLink
                        to="/settings"
                        class="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-white hover:bg-white/5"
                        active-class="!text-white bg-white/10"
                    >
                        Settings
                    </RouterLink>
                </div>
            </div>
        </header>

        <div
            v-if="capturePaused"
            class="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-200"
        >
            Capture is paused — nothing is being recorded. Resume in Settings or the toolbar popup.
        </div>
        <div
            v-if="session.tabs.some((t) => t.needsRefresh)"
            class="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-200"
        >
            A game tab is running an outdated BC Toolbox script — refresh that tab to resume capture.
        </div>

        <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
            <RouterView />
        </main>
    </div>
</template>
