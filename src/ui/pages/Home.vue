<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const router = useRouter();

onMounted(() => {
    void session.refreshTabs();
});

function pick(memberNumber: number) {
    void router.push({ name: 'dashboard', params: { viewer: memberNumber } });
}
</script>

<template>
    <div>
        <h1 class="mb-1 text-2xl font-semibold text-white">Select a character</h1>
        <p class="mb-6 text-sm text-neutral-400">
            Data is browsed from the point of view of one of your characters.
        </p>

        <div
            v-if="session.characters.length === 0"
            class="card mx-auto max-w-xl p-8 text-center text-neutral-400"
        >
            <p class="mb-2 text-lg text-neutral-200">No characters yet</p>
            <p class="text-sm leading-relaxed">
                Log into Bondage Club in a tab with the extension enabled and your character will
                appear here automatically.
            </p>
        </div>

        <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <button
                v-for="character in session.characters"
                :key="character.memberNumber"
                class="card group overflow-hidden text-left transition-transform hover:-translate-y-0.5 hover:border-accent-soft/40"
                @click="pick(character.memberNumber)"
            >
                <div class="flex h-56 items-center justify-center bg-surface-2/60 p-3">
                    <img
                        v-if="character.appearanceImage"
                        :src="character.appearanceImage"
                        alt=""
                        class="h-full object-contain"
                    />
                    <span v-else class="text-4xl text-neutral-600">?</span>
                </div>
                <div class="p-3">
                    <div class="truncate font-medium text-white">
                        {{ character.nickname || character.name }}
                    </div>
                    <div class="text-xs text-neutral-500">#{{ character.memberNumber }}</div>
                </div>
            </button>
        </div>
    </div>
</template>
