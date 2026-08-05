<script setup lang="ts">
/**
 * Library of every crafted item captured across all known members —
 * searchable, with attribution back to the maker's profile.
 */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import { useLiveQuery } from '../composables/useLiveQuery';

const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));
const search = ref('');

interface CraftRow {
    name: string;
    asset: string;
    description: string;
    lock: string;
    private: boolean;
    maker: number;
    makerName: string;
    makerColor?: string;
}

interface RawCraft {
    Item?: string;
    Name?: string;
    Description?: string;
    Lock?: string;
    Private?: boolean;
}

const crafts = useLiveQuery<CraftRow[]>(
    async () => {
        const rows: CraftRow[] = [];
        await db.members.each((member) => {
            for (const raw of (member.crafting ?? []) as (RawCraft | null)[]) {
                if (!raw?.Name && !raw?.Item) continue;
                rows.push({
                    name: raw.Name ?? '?',
                    asset: raw.Item ?? '',
                    description: raw.Description ?? '',
                    lock: raw.Lock ? raw.Lock.replace('Padlock', '') : '',
                    private: !!raw.Private,
                    maker: member.memberNumber,
                    makerName: member.nickname || member.name,
                    makerColor: member.labelColor,
                });
            }
        });
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    },
    [],
    [],
);

const filtered = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return crafts.value;
    return crafts.value.filter(
        (c) =>
            c.name.toLowerCase().includes(q) ||
            c.asset.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q) ||
            c.makerName.toLowerCase().includes(q),
    );
});

const makerCount = computed(() => new Set(crafts.value.map((c) => c.maker)).size);
</script>

<template>
    <div>
        <div class="mb-5 flex flex-wrap items-center gap-4">
            <h1 class="text-2xl font-semibold text-white">Crafts</h1>
            <span class="text-sm text-neutral-500">
                {{ crafts.length }} items from {{ makerCount }} makers
            </span>
            <input
                v-model="search"
                class="input ml-auto max-w-xs"
                placeholder="Search name, item, maker…"
            />
        </div>

        <div v-if="filtered.length === 0" class="card mx-auto max-w-md p-8 text-center text-neutral-400">
            <template v-if="crafts.length === 0">
                No crafted items captured yet — they're collected from profiles as you meet people.
            </template>
            <template v-else>No crafts match that search.</template>
        </div>

        <div v-else class="card overflow-x-auto">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-white/10 text-left text-neutral-500">
                        <th class="px-4 py-2 font-medium">Name</th>
                        <th class="px-4 py-2 font-medium">Description</th>
                        <th class="px-4 py-2 font-medium">Lock</th>
                        <th class="px-4 py-2 font-medium">Private</th>
                        <th class="px-4 py-2 font-medium">Made by</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(craft, index) in filtered"
                        :key="index"
                        class="border-b border-white/5 align-top last:border-0"
                    >
                        <td class="px-4 py-2">
                            <span class="text-neutral-200">{{ craft.name }}</span>
                            <span v-if="craft.asset" class="block text-xs text-neutral-500">{{
                                craft.asset
                            }}</span>
                        </td>
                        <td class="max-w-md px-4 py-2 text-neutral-400">{{ craft.description }}</td>
                        <td class="px-4 py-2 text-neutral-400">{{ craft.lock }}</td>
                        <td class="px-4 py-2 text-neutral-500">{{ craft.private ? 'Yes' : '' }}</td>
                        <td class="px-4 py-2">
                            <RouterLink
                                :to="{ name: 'member', params: { viewer, member: craft.maker } }"
                                class="hover:underline"
                                :style="{ color: craft.makerColor || '#e5e5e5' }"
                                >
{{ craft.makerName }}
</RouterLink
                            >
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
