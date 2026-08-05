<script setup lang="ts">
/**
 * View of the selected character's wardrobe save slots. This is a LIVE query
 * into the game tab (the wardrobe isn't captured to the database), so the
 * character must be online.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { WardrobeSlotInfo } from '@/shared/protocol';
import { api } from '../api';
import { useSessionStore } from '../stores/session';

const route = useRoute();
const session = useSessionStore();
const viewer = computed(() => Number(route.params.viewer));

const slots = ref<WardrobeSlotInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const online = computed(() => session.tabs.some((t) => t.memberNumber === viewer.value));

async function load() {
    loading.value = true;
    error.value = null;
    try {
        await session.refreshTabs();
        if (!online.value) {
            error.value = 'This character is not online in a game tab — the wardrobe can only be read live.';
            slots.value = [];
            return;
        }
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'player-wardrobe' },
        });
        if (!result.success) {
            error.value = result.error;
            slots.value = [];
            return;
        }
        slots.value = (result.data as { slots: WardrobeSlotInfo[] }).slots;
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}

onMounted(load);
watch(viewer, load);
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center gap-4">
            <h1 class="text-2xl font-semibold text-white">Wardrobe</h1>
            <span v-if="slots.length" class="text-sm text-neutral-500">{{ slots.length }} slots</span>
            <button class="btn ml-auto" :disabled="loading" @click="load">
                {{ loading ? 'Loading…' : 'Refresh' }}
            </button>
        </div>

        <div v-if="loading && !slots.length" class="card mx-auto max-w-md p-8 text-center text-neutral-400">
            Reading wardrobe from the game…
        </div>

        <div v-else-if="error" class="card mx-auto max-w-lg p-8 text-center">
            <p class="mb-2 text-neutral-200">Wardrobe unavailable</p>
            <p class="text-sm text-neutral-400">{{ error }}</p>
        </div>

        <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <div v-for="slot in slots" :key="slot.index" class="card overflow-hidden">
                <div class="flex h-52 items-center justify-center bg-surface-2/60 p-2">
                    <img v-if="slot.image" :src="slot.image" alt="" class="h-full object-contain" />
                    <span v-else class="px-4 text-center text-xs text-neutral-600">
                        Not rendered — open the wardrobe in-game once, then refresh
                    </span>
                </div>
                <div class="p-3">
                    <div class="truncate text-sm font-medium text-white">{{ slot.name }}</div>
                    <div class="text-xs text-neutral-500">Slot {{ slot.index + 1 }}</div>
                </div>
            </div>
        </div>
    </div>
</template>
