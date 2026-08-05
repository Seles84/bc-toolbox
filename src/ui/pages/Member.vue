<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import type { MemberRecord, MemberSeenRecord } from '@/shared/records';
import BioText from '../components/BioText.vue';
import { useLiveQuery } from '../composables/useLiveQuery';
import RelationshipsGraph from '../components/RelationshipsGraph.vue';
import { PRESET_TAGS, tagClass } from '../utils/tags';
import { api } from '../api';
import { useSessionStore } from '../stores/session';
import { decodeDescription } from '@/shared/description';
import { downloadText, safeFilename } from '../utils/transcript';
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

const tab = ref<
    'stats' | 'bio' | 'crafted' | 'relationships' | 'skills' | 'addons' | 'whispers' | 'notes'
>('stats');
const graphDepth = ref(3);
const pathQuery = ref('');
const pathTarget = ref<number | undefined>(undefined);
const pathFound = ref<boolean | undefined>(undefined);

/** Resolve the find-connection input: a member number, or a name lookup. */
async function findConnection() {
    pathFound.value = undefined;
    const query = pathQuery.value.trim();
    if (!query) {
        pathTarget.value = undefined;
        return;
    }
    if (/^\d+$/.test(query)) {
        pathTarget.value = Number(query);
        return;
    }
    const q = query.toLowerCase();
    const match = await db.members
        .filter(
            (m) =>
                m.name.toLowerCase() === q ||
                (m.nickname ?? '').toLowerCase() === q ||
                m.name.toLowerCase().includes(q) ||
                (m.nickname ?? '').toLowerCase().includes(q),
        )
        .first();
    if (match) {
        pathTarget.value = match.memberNumber;
    } else {
        pathTarget.value = undefined;
        pathFound.value = false;
    }
}

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
    { id: 'whispers', label: 'Whispers' },
    { id: 'notes', label: 'Notes' },
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

// -- On-demand profile refresh ------------------------------------------------

const session = useSessionStore();
const refreshing = ref(false);
const refreshError = ref<string | null>(null);
const refreshedAt = ref<number | null>(null);

/** Pull fresh data live from the game — works when both are in the same room. */
async function refreshProfile() {
    refreshing.value = true;
    refreshError.value = null;
    try {
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'character-data', memberNumber: memberNumber.value },
        });
        if (result.success) {
            refreshedAt.value = Date.now();
        } else {
            refreshError.value = result.error;
        }
    } catch (error) {
        refreshError.value = error instanceof Error ? error.message : String(error);
    } finally {
        refreshing.value = false;
    }
}

// -- Whisper history ---------------------------------------------------------

interface WhisperEntry {
    line: import('@/shared/records').ChatLogRecord;
    roomName?: string;
    /** Set on the first line of each room visit — renders a divider */
    divider?: string;
}

const whispers = useLiveQuery<WhisperEntry[]>(
    async () => {
        const me = viewer.value;
        const them = memberNumber.value;
        const lines = await db.chat
            .where('sender')
            .anyOf([me, them])
            .filter(
                (l) =>
                    l.type === 'Whisper' &&
                    // target === undefined covers incoming whispers stored
                    // before capture recorded the implicit target (us).
                    ((l.sender === them && (l.target === me || l.target === undefined)) ||
                        (l.sender === me && l.target === them)),
            )
            .sortBy('created');

        const channelIds = [...new Set(lines.map((l) => l.channelId))];
        const channels = await db.chatChannels.bulkGet(channelIds);
        const roomById = new Map(channels.filter((c) => !!c).map((c) => [c!.id!, c!.roomName]));

        let lastChannel: number | null = null;
        return lines.map((line) => {
            const entry: WhisperEntry = { line, roomName: roomById.get(line.channelId) };
            if (line.channelId !== lastChannel) {
                lastChannel = line.channelId;
                entry.divider = `${roomById.get(line.channelId) ?? 'Unknown room'} · ${new Date(line.created).toLocaleString()}`;
            }
            return entry;
        });
    },
    [memberNumber, viewer],
    [],
);

// -- Whisper sending ---------------------------------------------------------

const whisperDraft = ref('');
const whisperSending = ref(false);
const whisperError = ref<string | null>(null);

async function sendWhisper() {
    const text = whisperDraft.value.trim();
    if (!text || whisperSending.value) return;
    whisperSending.value = true;
    whisperError.value = null;
    try {
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'send-whisper', target: memberNumber.value, message: text },
        });
        if (result.success) {
            whisperDraft.value = ''; // the line arrives via live capture
        } else {
            whisperError.value = result.error;
        }
    } catch (error) {
        whisperError.value = error instanceof Error ? error.message : String(error);
    } finally {
        whisperSending.value = false;
    }
}

function exportWhispers() {
    const name = member.value ? member.value.nickname || member.value.name : `#${memberNumber.value}`;
    const lines = whispers.value.map((entry) => {
        const time = new Date(entry.line.created).toLocaleString();
        const from = entry.line.sender === viewer.value ? 'You' : name;
        const room = entry.roomName ? ` (${entry.roomName})` : '';
        return `[${time}]${room} ${from}: ${entry.line.message}`;
    });
    downloadText(
        `whispers-${safeFilename(name)}.txt`,
        [`Whispers with ${name} (#${memberNumber.value})`, '', ...lines].join('\n'),
    );
}

// -- Notes & tags ------------------------------------------------------------

const savedNote = useLiveQuery(
    async () =>
        (await db.notes
            .where('[member+viewer]')
            .equals([memberNumber.value, viewer.value])
            .first()) ?? null,
    [memberNumber, viewer],
    null as import('@/shared/records').MemberNoteRecord | null,
);

const noteText = ref('');
const noteTags = ref<string[]>([]);
const customTag = ref('');
const noteDirty = ref(false);
const noteSavedAt = ref<number | null>(null);

watch(
    [memberNumber, savedNote],
    ([, record], [previousMember]) => {
        // Seed the editor from storage on member switch or first load; don't
        // clobber unsaved edits when the live query re-emits.
        if (memberNumber.value !== previousMember || !noteDirty.value) {
            noteText.value = record?.note ?? '';
            noteTags.value = [...(record?.tags ?? [])];
            if (memberNumber.value !== previousMember) {
                noteDirty.value = false;
                noteSavedAt.value = null;
            }
        }
    },
    { immediate: true },
);

function toggleTag(tag: string) {
    const index = noteTags.value.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
    if (index >= 0) {
        noteTags.value.splice(index, 1);
    } else {
        noteTags.value.push(tag);
    }
    noteDirty.value = true;
}

function addCustomTag() {
    const tag = customTag.value.trim();
    if (tag && !noteTags.value.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        noteTags.value.push(tag);
        noteDirty.value = true;
    }
    customTag.value = '';
}

async function saveNote() {
    const record = {
        member: memberNumber.value,
        viewer: viewer.value,
        note: noteText.value,
        tags: noteTags.value,
        updated: Date.now(),
    };
    const existing = savedNote.value;
    if (existing?.id !== undefined) {
        await db.notes.update(existing.id, record);
    } else {
        await db.notes.add(record);
    }
    noteDirty.value = false;
    noteSavedAt.value = Date.now();
}

/** Bios stored before capture-side decompression may still be compressed. */
const bio = computed(() => decodeDescription(member.value?.description));

const dominance = computed(() => dominanceInfo(member.value));
const pronouns = computed(() => pronounsInfo(member.value?.pronouns));
const ownership = computed(() => member.value?.ownership ?? null);

/** Past ownership/lovership states, newest first, as display strings. */
const relationshipHistory = computed(() =>
    [...(member.value?.relationshipHistory ?? [])].reverse().map((entry) => {
        const parts: string[] = [];
        if ('ownership' in entry) {
            parts.push(
                entry.ownership?.MemberNumber
                    ? `${collarStateLabel(entry.ownership.Stage)} by ${entry.ownership.Name ?? `#${entry.ownership.MemberNumber}`}`
                    : 'unowned',
            );
        }
        if (entry.lovership) {
            const names = entry.lovership
                .filter((l) => l.Name || l.MemberNumber)
                .map(
                    (l) =>
                        `${l.Name ?? `#${l.MemberNumber}`} (${loverStateLabel(l.Stage)})`,
                );
            parts.push(names.length ? `lovers: ${names.join(', ')}` : 'no lovers');
        }
        return { changed: entry.changed, text: parts.join(' · ') };
    }),
);

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
            <div class="mb-1 flex flex-wrap items-center gap-3">
                <p class="text-sm text-neutral-500">{{ member.name }} · #{{ member.memberNumber }}</p>
                <button
                    v-if="session.viewerOnline && memberNumber !== viewer"
                    class="btn px-2 py-0.5 text-xs"
                    :disabled="refreshing"
                    title="Pull fresh profile data from the game — you need to be in the same room"
                    @click="refreshProfile"
                >
                    {{ refreshing ? 'Updating…' : 'Update now' }}
                </button>
                <span v-if="refreshedAt" class="text-xs text-emerald-400">Updated</span>
                <span v-if="refreshError" class="text-xs text-red-400">{{ refreshError }}</span>
                <RouterLink
                    v-if="memberNumber !== viewer"
                    :to="{ name: 'beeps', params: { viewer }, query: { member: memberNumber } }"
                    class="btn px-2 py-0.5 text-xs"
                    title="Open the beep conversation with this member"
                >
                    Beep
                </RouterLink>
            </div>
            <p v-if="member.nameHistory?.length" class="mb-1 text-xs text-neutral-600">
                Previously:
                <template v-for="(entry, index) in member.nameHistory.slice().reverse()" :key="index">
                    <span :title="new Date(entry.changed).toLocaleString()">
                        {{ entry.nickname || entry.name
                        }}<template v-if="entry.nickname && entry.name && entry.nickname !== entry.name">
                            ({{ entry.name }})</template
                        ></span
                    ><template v-if="index < member.nameHistory.length - 1">, </template>
                </template>
            </p>
            <div v-if="noteTags.length" class="mb-2 flex flex-wrap gap-1.5">
                <span
                    v-for="noteTag in noteTags"
                    :key="noteTag"
                    class="rounded px-1.5 py-0.5 text-[11px] font-medium"
                    :class="tagClass(noteTag)"
                    >{{ noteTag }}</span
                >
            </div>
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
                        <BioText v-if="bio" :text="bio" />
                        <p v-else class="text-sm text-neutral-500">No bio recorded.</p>
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
                        <p v-else class="text-sm text-neutral-500">No crafted items recorded.</p>
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

                        <section v-if="relationshipHistory.length">
                            <h3 class="mb-2 text-sm font-semibold text-neutral-400">History</h3>
                            <ul class="space-y-1 text-sm">
                                <li v-for="(entry, index) in relationshipHistory" :key="index">
                                    <span class="text-neutral-500"
                                        >Until {{ formatDay(entry.changed) }}:</span
                                    >
                                    <span class="text-neutral-300"> {{ entry.text }}</span>
                                </li>
                            </ul>
                        </section>

                        <section>
                            <div class="mb-2 flex flex-wrap items-center gap-3">
                                <h3 class="text-sm font-semibold text-neutral-400">Family graph</h3>
                                <select
                                    v-model.number="graphDepth"
                                    class="input w-auto py-1 text-xs"
                                >
                                    <option v-for="d in DEPTHS" :key="d.value" :value="d.value">
                                        {{ d.label }}
                                    </option>
                                </select>
                                <form
                                    class="flex items-center gap-1.5"
                                    @submit.prevent="findConnection"
                                >
                                    <input
                                        v-model="pathQuery"
                                        class="input w-44 py-1 text-xs"
                                        placeholder="Connection to… (name or #)"
                                    />
                                    <button type="submit" class="btn px-2 py-1 text-xs">Find</button>
                                </form>
                                <span v-if="pathFound === false" class="text-xs text-amber-400">
                                    No known connection
                                </span>
                            </div>
                            <RelationshipsGraph
                                :focal="memberNumber"
                                :depth="graphDepth"
                                :viewer="viewer"
                                :path-target="pathTarget"
                                @path-result="pathFound = $event"
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
                        <p v-else class="text-sm text-neutral-500">No skills recorded.</p>
                    </div>

                    <!-- Whispers -->
                    <div v-else-if="tab === 'whispers'">
                        <p v-if="whispers.length === 0" class="text-sm text-neutral-500">
                            No whispers recorded with this member.
                        </p>
                        <div v-else class="mb-2 flex justify-end">
                            <button class="btn px-2 py-0.5 text-xs" @click="exportWhispers">
                                Export thread
                            </button>
                        </div>
                        <div v-if="whispers.length" class="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
                            <template v-for="entry in whispers" :key="entry.line.id">
                                <p
                                    v-if="entry.divider"
                                    class="pt-3 pb-1 text-center text-[11px] text-neutral-600 first:pt-0"
                                >
                                    — {{ entry.divider }} —
                                </p>
                                <div
                                    class="flex"
                                    :class="
                                        entry.line.sender === viewer ? 'justify-end' : 'justify-start'
                                    "
                                >
                                    <div
                                        class="max-w-[75%] rounded-lg px-3 py-1.5"
                                        :class="
                                            entry.line.sender === viewer
                                                ? 'bg-accent/20 text-neutral-100'
                                                : 'bg-surface-2 text-neutral-200'
                                        "
                                    >
                                        <p class="text-sm whitespace-pre-wrap">{{ entry.line.message }}</p>
                                        <p class="mt-0.5 text-[10px] text-neutral-500">
                                            {{
                                                new Date(entry.line.created).toLocaleTimeString([], {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })
                                            }}
                                        </p>
                                    </div>
                                </div>
                            </template>
                        </div>

                        <form
                            class="mt-3 border-t border-white/10 pt-3"
                            @submit.prevent="sendWhisper"
                        >
                            <div class="flex gap-2">
                                <input
                                    v-model="whisperDraft"
                                    class="input flex-1"
                                    :disabled="!session.viewerOnline || whisperSending"
                                    :placeholder="
                                        session.viewerOnline
                                            ? 'Whisper… (they must be in your room)'
                                            : 'Your character must be online to whisper'
                                    "
                                />
                                <button
                                    type="submit"
                                    class="btn btn-accent"
                                    :disabled="
                                        !session.viewerOnline || whisperSending || !whisperDraft.trim()
                                    "
                                >
                                    {{ whisperSending ? 'Sending…' : 'Send' }}
                                </button>
                            </div>
                            <p v-if="whisperError" class="mt-2 text-xs text-red-400">
                                {{ whisperError }}
                            </p>
                        </form>
                    </div>

                    <!-- Notes -->
                    <div v-else-if="tab === 'notes'" class="space-y-4">
                        <div>
                            <h3 class="mb-2 text-sm font-semibold text-neutral-400">Tags</h3>
                            <div class="flex flex-wrap items-center gap-1.5">
                                <button
                                    v-for="preset in PRESET_TAGS"
                                    :key="preset.tag"
                                    class="rounded px-2 py-0.5 text-xs font-medium transition-opacity"
                                    :class="[
                                        preset.class,
                                        noteTags.some((t) => t.toLowerCase() === preset.tag.toLowerCase())
                                            ? ''
                                            : 'opacity-35 hover:opacity-70',
                                    ]"
                                    @click="toggleTag(preset.tag)"
                                >
                                    {{ preset.tag }}
                                </button>
                                <span
                                    v-for="custom in noteTags.filter(
                                        (t) =>
                                            !PRESET_TAGS.some(
                                                (p) => p.tag.toLowerCase() === t.toLowerCase(),
                                            ),
                                    )"
                                    :key="custom"
                                    class="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
                                    :class="tagClass(custom)"
                                >
                                    {{ custom }}
                                    <button class="hover:text-white" @click="toggleTag(custom)">×</button>
                                </span>
                                <input
                                    v-model="customTag"
                                    class="input w-32 py-0.5 text-xs"
                                    placeholder="Add tag…"
                                    @keydown.enter.prevent="addCustomTag"
                                />
                            </div>
                            <p class="mt-2 text-xs text-neutral-600">
                                Members tagged <span class="text-sky-300">Watch</span> trigger a
                                desktop notification when they come online.
                            </p>
                        </div>

                        <div>
                            <h3 class="mb-2 text-sm font-semibold text-neutral-400">Note</h3>
                            <textarea
                                v-model="noteText"
                                rows="8"
                                class="input resize-y font-normal"
                                placeholder="Private notes about this member — only stored in your local database."
                                @input="noteDirty = true"
                            ></textarea>
                        </div>

                        <div class="flex items-center gap-3">
                            <button class="btn btn-accent" :disabled="!noteDirty" @click="saveNote">
                                Save
                            </button>
                            <span v-if="noteDirty" class="text-xs text-amber-400">Unsaved changes</span>
                            <span v-else-if="noteSavedAt" class="text-xs text-emerald-400">Saved</span>
                        </div>
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
        You haven't met member #{{ memberNumber }} yet.
    </div>
</template>
