<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { MemberRecord, MemberSeenRecord } from '@/shared/records';
import BioText from '../components/BioText.vue';
import { useLiveQuery } from '../composables/useLiveQuery';
import RelationshipsGraph from '../components/RelationshipsGraph.vue';
import {
    collarStateLabel,
    daysSince,
    difficultyLabel,
    dominanceInfo,
    durationSince,
    loverStateLabel,
    permissionLabel,
    pronounsInfo,
} from '../utils/labels';

const route = useRoute();
const viewer = computed(() => Number(route.params.viewer));
const memberNumber = computed(() => Number(route.params.member));

const tab = ref<'stats' | 'bio' | 'crafted' | 'relationships' | 'skills' | 'addons'>('stats');
const graphDepth = ref(3);

const DEPTHS = [
    { label: 'Direct family', value: 1 },
    { label: 'Local family', value: 2 },
    { label: 'Extended family', value: 3 },
    { label: 'Full family', value: 99 },
] as const;

const TABS = [
    { id: 'stats', label: 'Stats' },
    { id: 'bio', label: 'Bio' },
    { id: 'crafted', label: 'Crafted Items' },
    { id: 'relationships', label: 'Relationships' },
    { id: 'skills', label: 'Skills' },
    { id: 'addons', label: 'Addons' },
] as const;

function subsOf(ownerNumber: number): Promise<MemberRecord[]> {
    return db.members
        .filter((m) => m.ownership?.MemberNumber === ownerNumber)
        .toArray()
        .then((rows) =>
            rows.sort(
                (a, b) =>
                    (b.ownership?.Stage ?? 0) - (a.ownership?.Stage ?? 0) ||
                    (a.ownership?.Start ?? 0) - (b.ownership?.Start ?? 0),
            ),
        );
}

const profile = useLiveQuery(
    async () => {
        const record = (await db.members.get(memberNumber.value)) ?? null;
        const seenRecord =
            (await db.memberSeen
                .where('[member+viewer]')
                .equals([memberNumber.value, viewer.value])
                .first()) ?? null;
        const subs = await subsOf(memberNumber.value);
        const ownerNumber = record?.ownership?.MemberNumber;
        const siblings = ownerNumber
            ? (await subsOf(ownerNumber)).filter((m) => m.memberNumber !== memberNumber.value)
            : [];
        return { member: record, seen: seenRecord, submissives: subs, collarSiblings: siblings };
    },
    [memberNumber, viewer],
    {
        member: null as MemberRecord | null,
        seen: null as MemberSeenRecord | null,
        submissives: [] as MemberRecord[],
        collarSiblings: [] as MemberRecord[],
    },
);

const member = computed(() => profile.value.member);
const seen = computed(() => profile.value.seen);
const submissives = computed(() => profile.value.submissives);
const collarSiblings = computed(() => profile.value.collarSiblings);

const dominance = computed(() => dominanceInfo(member.value));
const pronouns = computed(() => pronounsInfo(member.value?.pronouns));
const ownership = computed(() => member.value?.ownership ?? null);

const lovers = computed(() =>
    [...(member.value?.lovership ?? [])]
        .filter((l) => l.Name || l.MemberNumber)
        .sort((a, b) => (b.Stage ?? 0) - (a.Stage ?? 0) || (a.Start ?? 0) - (b.Start ?? 0)),
);

interface CraftedItem {
    Item?: string;
    Name?: string;
    Description?: string;
    Lock?: string;
    Private?: boolean;
}

const craftedItems = computed(() =>
    ((member.value?.crafting ?? []) as (CraftedItem | null)[])
        .filter((item): item is CraftedItem => !!item)
        .map((item) => ({
            name: item.Name ?? '?',
            asset: item.Item ?? '',
            description: item.Description ?? '',
            lock: item.Lock ? item.Lock.replace('Padlock', '') : 'None',
            private: item.Private ? 'Yes' : 'No',
        })),
);

interface AddonRow {
    name: string;
    version?: string;
    repository?: string;
}

const addons = computed<AddonRow[]>(() => {
    const raw = member.value?.addons;
    if (!raw) return [];
    const rows: AddonRow[] = [];
    for (const [key, value] of Object.entries(raw)) {
        if (key === 'FBCOtherAddons' && Array.isArray(value)) {
            for (const entry of value as { fullName?: string; name?: string; version?: string; repository?: string }[]) {
                rows.push({
                    name: entry.fullName || entry.name || '?',
                    version: entry.version,
                    repository: entry.repository,
                });
            }
        } else if (key === 'FBC' && typeof value === 'string') {
            rows.push({ name: 'FBC', version: value });
        } else if (value && typeof value === 'object') {
            const version = (value as { Version?: string }).Version;
            rows.push({ name: key, version });
        } else {
            rows.push({ name: key });
        }
    }
    const seenNames = new Set<string>();
    return rows.filter((row) => {
        const key = row.name.toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
    });
});

function formatDate(timestamp?: number): string {
    return timestamp ? new Date(timestamp).toLocaleString() : '—';
}

function formatDay(timestamp?: number): string {
    return timestamp ? new Date(timestamp).toLocaleDateString() : '—';
}

const stats = computed(() => {
    const joined = member.value?.creation;
    const joinedDays = daysSince(joined);
    return [
        { label: 'Member number', value: `#${memberNumber.value}` },
        { label: 'Title', value: member.value?.title ?? '—' },
        { label: 'Pronouns', value: `${pronouns.value.symbol} ${pronouns.value.name}` },
        {
            label: 'Orientation',
            value:
                dominance.value.type === 'Switch'
                    ? 'Switch'
                    : `${dominance.value.type} ${dominance.value.level}%`,
        },
        { label: 'Difficulty', value: difficultyLabel(member.value?.difficulty) },
        { label: 'Item permissions', value: permissionLabel(member.value?.itemPermission) },
        {
            label: 'Joined',
            value: joined ? `${formatDay(joined)}${joinedDays !== null ? ` (${joinedDays} days ago)` : ''}` : '—',
        },
        { label: 'First seen', value: formatDate(seen.value?.firstSeen) },
        { label: 'Last seen', value: formatDate(seen.value?.lastSeen) },
        { label: 'Last location', value: seen.value?.lastLocation ?? '—' },
        { label: 'Profile updated', value: formatDate(member.value?.capturedAt) },
    ];
});
</script>

<template>
    <div v-if="member" class="flex flex-col gap-6 lg:flex-row">
        <div class="card flex w-full items-start justify-center p-4 lg:w-80 lg:shrink-0">
            <img
                v-if="member.appearanceImage"
                :src="member.appearanceImage"
                alt=""
                class="max-h-[36rem] object-contain"
            />
            <span v-else class="py-24 text-5xl text-neutral-600">?</span>
        </div>

        <div class="min-w-0 flex-1">
            <h1 class="text-3xl font-semibold" :style="{ color: member.labelColor || '#ffffff' }">
                {{ member.nickname || member.name }}
            </h1>
            <p class="mb-1 text-sm text-neutral-500">{{ member.name }} · #{{ member.memberNumber }}</p>
            <p v-if="ownership?.Name" class="mb-4 text-sm text-neutral-400">
                {{ collarStateLabel(ownership.Stage) }} by
                <RouterLink
                    v-if="ownership.MemberNumber"
                    :to="{ name: 'member', params: { viewer, member: ownership.MemberNumber } }"
                    class="text-accent-soft hover:underline"
                    >
{{ ownership.Name }}
</RouterLink
                >
                <template v-else>{{ ownership.Name }}</template>
                <span v-if="ownership.Start" class="text-neutral-500">
                    · {{ durationSince(ownership.Start) }}</span
                >
            </p>
            <p v-else class="mb-4 text-sm text-neutral-500">Unowned</p>

            <div class="card">
                <div class="flex flex-wrap gap-1 border-b border-white/10 p-2">
                    <button
                        v-for="t in TABS"
                        :key="t.id"
                        class="rounded-md px-3 py-1.5 text-sm"
                        :class="
                            tab === t.id
                                ? 'bg-white/10 text-white'
                                : 'text-neutral-400 hover:bg-white/5 hover:text-white'
                        "
                        @click="tab = t.id"
                    >
                        {{ t.label }}
                    </button>
                </div>

                <div class="p-4">
                    <!-- Stats -->
                    <dl v-if="tab === 'stats'" class="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                        <div v-for="stat in stats" :key="stat.label" class="flex justify-between gap-4">
                            <dt class="shrink-0 text-sm text-neutral-500">{{ stat.label }}</dt>
                            <dd class="text-right text-sm text-neutral-200">{{ stat.value }}</dd>
                        </div>
                    </dl>

                    <!-- Bio -->
                    <div v-else-if="tab === 'bio'">
                        <BioText v-if="member.description" :text="member.description" />
                        <p v-else class="text-sm text-neutral-500">No bio captured.</p>
                    </div>

                    <!-- Crafted items -->
                    <div v-else-if="tab === 'crafted'" class="overflow-x-auto">
                        <table v-if="craftedItems.length" class="w-full text-sm">
                            <thead>
                                <tr class="border-b border-white/10 text-left text-neutral-500">
                                    <th class="py-2 pr-4 font-medium">Name</th>
                                    <th class="py-2 pr-4 font-medium">Description</th>
                                    <th class="py-2 pr-4 font-medium">Lock</th>
                                    <th class="py-2 font-medium">Private</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="(item, index) in craftedItems"
                                    :key="index"
                                    class="border-b border-white/5 align-top last:border-0"
                                >
                                    <td class="py-2 pr-4">
                                        <span class="text-neutral-200">{{ item.name }}</span>
                                        <span v-if="item.asset" class="block text-xs text-neutral-500">{{
                                            item.asset
                                        }}</span>
                                    </td>
                                    <td class="py-2 pr-4 text-neutral-400">{{ item.description }}</td>
                                    <td class="py-2 pr-4 text-neutral-400">{{ item.lock }}</td>
                                    <td class="py-2 text-neutral-400">{{ item.private }}</td>
                                </tr>
                            </tbody>
                        </table>
                        <p v-else class="text-sm text-neutral-500">No crafted items captured.</p>
                    </div>

                    <!-- Relationships -->
                    <div v-else-if="tab === 'relationships'" class="space-y-5">
                        <section v-if="ownership?.Name">
                            <h3 class="mb-2 text-sm font-semibold text-neutral-400">Owner</h3>
                            <ul class="space-y-1 text-sm">
                                <li>
                                    <RouterLink
                                        v-if="ownership.MemberNumber"
                                        :to="{
                                            name: 'member',
                                            params: { viewer, member: ownership.MemberNumber },
                                        }"
                                        class="text-accent-soft hover:underline"
                                        >
{{ ownership.Name }}
</RouterLink
                                    >
                                    <template v-else>{{ ownership.Name }}</template>
                                    <span class="text-neutral-500">
                                        — {{ collarStateLabel(ownership.Stage) }}
                                        <template v-if="ownership.Start">
                                            since {{ formatDay(ownership.Start) }} ({{
                                                durationSince(ownership.Start)
                                            }})</template
                                        >
                                    </span>
                                </li>
                            </ul>
                        </section>

                        <section v-if="collarSiblings.length">
                            <h3 class="mb-2 text-sm font-semibold text-neutral-400">Collar siblings</h3>
                            <ul class="space-y-1 text-sm">
                                <li v-for="sibling in collarSiblings" :key="sibling.memberNumber">
                                    <RouterLink
                                        :to="{
                                            name: 'member',
                                            params: { viewer, member: sibling.memberNumber },
                                        }"
                                        class="text-accent-soft hover:underline"
                                        >
{{ sibling.nickname || sibling.name }}
</RouterLink
                                    >
                                    <span class="text-neutral-500">
                                        — {{ collarStateLabel(sibling.ownership?.Stage) }}
                                        <template v-if="sibling.ownership?.Start">
                                            since {{ formatDay(sibling.ownership.Start) }}</template
                                        >
                                    </span>
                                </li>
                            </ul>
                        </section>

                        <section v-if="submissives.length">
                            <h3 class="mb-2 text-sm font-semibold text-neutral-400">Submissives</h3>
                            <ul class="space-y-1 text-sm">
                                <li v-for="sub in submissives" :key="sub.memberNumber">
                                    <RouterLink
                                        :to="{ name: 'member', params: { viewer, member: sub.memberNumber } }"
                                        class="text-accent-soft hover:underline"
                                        >
{{ sub.nickname || sub.name }}
</RouterLink
                                    >
                                    <span class="text-neutral-500">
                                        — {{ collarStateLabel(sub.ownership?.Stage) }}
                                        <template v-if="sub.ownership?.Start">
                                            since {{ formatDay(sub.ownership.Start) }}</template
                                        >
                                    </span>
                                </li>
                            </ul>
                        </section>

                        <section v-if="lovers.length">
                            <h3 class="mb-2 text-sm font-semibold text-neutral-400">Lovers</h3>
                            <ul class="space-y-1 text-sm">
                                <li v-for="(lover, index) in lovers" :key="index">
                                    <RouterLink
                                        v-if="lover.MemberNumber"
                                        :to="{
                                            name: 'member',
                                            params: { viewer, member: lover.MemberNumber },
                                        }"
                                        class="text-accent-soft hover:underline"
                                        >
{{ lover.Name ?? `#${lover.MemberNumber}` }}
</RouterLink
                                    >
                                    <template v-else>{{ lover.Name }}</template>
                                    <span class="text-neutral-500">
                                        — {{ loverStateLabel(lover.Stage) }}
                                        <template v-if="lover.Start">
                                            since {{ formatDay(lover.Start) }} ({{
                                                durationSince(lover.Start)
                                            }})</template
                                        >
                                    </span>
                                </li>
                            </ul>
                        </section>

                        <p
                            v-if="!ownership?.Name && !submissives.length && !lovers.length"
                            class="text-sm text-neutral-500"
                        >
                            No known relationships.
                        </p>

                        <section>
                            <div class="mb-2 flex items-center gap-3">
                                <h3 class="text-sm font-semibold text-neutral-400">Family graph</h3>
                                <select
                                    v-model.number="graphDepth"
                                    class="input w-auto py-1 text-xs"
                                >
                                    <option v-for="d in DEPTHS" :key="d.value" :value="d.value">
                                        {{ d.label }}
                                    </option>
                                </select>
                            </div>
                            <RelationshipsGraph
                                :focal="memberNumber"
                                :depth="graphDepth"
                                :viewer="viewer"
                            />
                        </section>
                    </div>

                    <!-- Skills -->
                    <div v-else-if="tab === 'skills'">
                        <table v-if="member.skills?.length" class="w-full text-sm">
                            <tbody>
                                <tr
                                    v-for="skill in member.skills"
                                    :key="skill.Type"
                                    class="border-b border-white/5 last:border-0"
                                >
                                    <td class="py-1.5 text-neutral-300">{{ skill.Type }}</td>
                                    <td class="py-1.5 text-right text-neutral-400">
                                        Level {{ skill.Level }} ({{ Math.round((skill.Progress ?? 0) / 10) }}%)
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <p v-else class="text-sm text-neutral-500">No skills captured.</p>
                    </div>

                    <!-- Addons -->
                    <div v-else-if="tab === 'addons'">
                        <table v-if="addons.length" class="w-full text-sm">
                            <tbody>
                                <tr
                                    v-for="addon in addons"
                                    :key="addon.name"
                                    class="border-b border-white/5 last:border-0"
                                >
                                    <td class="py-1.5 text-neutral-200">{{ addon.name }}</td>
                                    <td class="py-1.5 text-right text-neutral-500">{{ addon.version ?? '' }}</td>
                                    <td class="py-1.5 text-right">
                                        <a
                                            v-if="addon.repository"
                                            :href="addon.repository"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="text-accent-soft hover:underline"
                                            >source</a
                                        >
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <p v-else class="text-sm text-neutral-500">No addons detected.</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div v-else class="card mx-auto max-w-md p-8 text-center text-neutral-400">
        Member #{{ memberNumber }} has not been captured yet.
    </div>
</template>
