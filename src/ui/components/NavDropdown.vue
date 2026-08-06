<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';

export interface NavDropdownItem {
    /** Route name to link to */
    name: string;
    label: string;
    /** Extra route names that should count as "inside" this item (detail pages) */
    match?: string[];
}

const props = defineProps<{
    label: string;
    items: NavDropdownItem[];
    viewer: number;
}>();

const route = useRoute();
const open = ref(false);
const root = ref<HTMLElement>();

const active = computed(() =>
    props.items.some(
        (item) => item.name === route.name || item.match?.includes(String(route.name)),
    ),
);

function itemActive(item: NavDropdownItem): boolean {
    return item.name === route.name || !!item.match?.includes(String(route.name));
}

function onDocumentClick(event: MouseEvent) {
    if (open.value && root.value && !root.value.contains(event.target as Node)) {
        open.value = false;
    }
}
function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        open.value = false;
    }
}
onMounted(() => {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
    <div ref="root" class="relative">
        <button
            class="flex items-center gap-1 rounded-md px-3 py-1.5 hover:text-white hover:bg-white/5"
            :class="active ? 'text-white bg-white/10' : 'text-neutral-400'"
            @click="open = !open"
        >
            {{ label }}
            <svg
                class="h-3 w-3 opacity-60 transition-transform"
                :class="open ? 'rotate-180' : ''"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
            >
                <path d="M3 4.5 6 7.5 9 4.5" />
            </svg>
        </button>
        <div
            v-if="open"
            class="absolute left-0 top-full z-30 mt-1 min-w-40 rounded-lg border border-white/10 bg-surface-2 py-1 shadow-xl shadow-black/40"
        >
            <RouterLink
                v-for="item in items"
                :key="item.name"
                :to="{ name: item.name, params: { viewer } }"
                class="block px-3 py-1.5 hover:text-white hover:bg-white/5"
                :class="itemActive(item) ? 'text-white bg-white/10' : 'text-neutral-300'"
                @click="open = false"
            >
                {{ item.label }}
            </RouterLink>
        </div>
    </div>
</template>
