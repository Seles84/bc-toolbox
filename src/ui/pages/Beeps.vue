<script setup lang="ts">
/**
 * Beep history for the selected character: conversation list on the left,
 * message thread with the selected person on the right.
 */
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { db } from '@/shared/db';
import { composeBeepMessage, parseBeepMessage, type BeepMeta } from '@/shared/beepMessage';
import type { BeepRecord } from '@/shared/records';
import { useLiveQuery } from '../composables/useLiveQuery';
import { api } from '../api';
import { useSessionStore } from '../stores/session';
import { downloadText, safeFilename } from '../utils/transcript';

const route = useRoute();
const session = useSessionStore();
const viewer = computed(() => Number(route.params.viewer));

const preselect = Number(route.query.member);
const selected = ref<number | null>(Number.isFinite(preselect) && preselect > 0 ? preselect : null);

const beeps = useLiveQuery<BeepRecord[]>(
    () => db.beeps.where('viewer').equals(viewer.value).sortBy('created'),
    [viewer],
    [],
);

interface Conversation {
    member: number;
    name: string;
    lastBeep: BeepRecord;
    count: number;
}

const conversations = computed<Conversation[]>(() => {
    const byMember = new Map<number, Conversation>();
    for (const beep of beeps.value) {
        const existing = byMember.get(beep.member);
        if (existing) {
            existing.lastBeep = beep;
            existing.count++;
            if (beep.memberName) existing.name = beep.memberName;
        } else {
            byMember.set(beep.member, {
                member: beep.member,
                name: beep.memberName ?? `#${beep.member}`,
                lastBeep: beep,
                count: 1,
            });
        }
    }
    return [...byMember.values()].sort((a, b) => b.lastBeep.created - a.lastBeep.created);
});

watch(conversations, (value) => {
    if (selected.value === null && value.length > 0) {
        selected.value = value[0]!.member;
    }
});

/**
 * Displayable text + addon metadata for a beep. Rows captured before metadata
 * parsing existed still have the JSON glued to the message — re-parse those.
 */
function displayOf(beep: BeepRecord): { text?: string; meta?: BeepMeta } {
    if (beep.metadata) {
        return { text: beep.message, meta: beep.metadata as BeepMeta };
    }
    return parseBeepMessage(beep.message);
}

const thread = computed(() =>
    beeps.value
        .filter((b) => b.member === selected.value)
        .map((beep) => ({ beep, display: displayOf(beep) })),
);

// Fallback name lookup for a preselected member with no beep history yet.
const selectedRecord = useLiveQuery(
    async () => (selected.value ? ((await db.members.get(selected.value)) ?? null) : null),
    [selected],
    null,
);

const selectedName = computed(
    () =>
        conversations.value.find((c) => c.member === selected.value)?.name ??
        (selectedRecord.value
            ? selectedRecord.value.nickname || selectedRecord.value.name
            : selected.value
              ? `#${selected.value}`
              : ''),
);

function exportThread() {
    if (!selected.value) return;
    const lines = thread.value.map(({ beep, display }) => {
        const time = new Date(beep.created).toLocaleString();
        const from = beep.direction === 'out' ? 'You' : selectedName.value;
        return `[${time}] ${from}: ${display.text ?? '(beep)'}`;
    });
    downloadText(
        `beeps-${safeFilename(selectedName.value)}.txt`,
        [`Beeps with ${selectedName.value} (#${selected.value})`, '', ...lines].join('\n'),
    );
}

// -- Sending -----------------------------------------------------------------

const draft = ref('');
const sending = ref(false);
const sendError = ref<string | null>(null);

async function sendBeep() {
    const text = draft.value.trim();
    if (!text || !selected.value || sending.value) return;
    sending.value = true;
    sendError.value = null;
    try {
        // WCE instant-messenger format so recipients using it see the color.
        const message = composeBeepMessage(text, {
            messageType: 'Message',
            messageColor: session.viewerRecord?.labelColor ?? '#ffffff',
        });
        const result = await api('page.query', {
            memberNumber: viewer.value,
            query: { type: 'send-beep', target: selected.value, message },
        });
        if (result.success) {
            draft.value = '';
        } else {
            sendError.value = result.error;
        }
    } catch (error) {
        sendError.value = error instanceof Error ? error.message : String(error);
    } finally {
        sending.value = false;
    }
}

function previewOf(beep: BeepRecord): string {
    return displayOf(beep).text || '(no message)';
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
</script>

<template>
    <div>
        <h1 class="mb-5 text-2xl font-semibold text-white">Beeps</h1>

        <div
            v-if="conversations.length === 0 && !selected"
            class="card mx-auto max-w-md p-8 text-center text-neutral-400"
        >
            No beeps recorded for this character yet — they're logged as they happen while the
            game tab is open.
        </div>

        <div v-else class="flex flex-col gap-4 lg:flex-row">
            <aside class="card h-fit w-full lg:w-72 lg:shrink-0">
                <button
                    v-for="conversation in conversations"
                    :key="conversation.member"
                    class="flex w-full items-center gap-3 border-b border-white/5 px-4 py-3 text-left last:border-0 hover:bg-white/5"
                    :class="selected === conversation.member ? 'bg-white/10' : ''"
                    @click="selected = conversation.member"
                >
                    <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-medium text-white">
                            {{ conversation.name }}
                            <span class="text-xs text-neutral-600">#{{ conversation.member }}</span>
                        </div>
                        <div class="truncate text-xs text-neutral-500">
                            {{ previewOf(conversation.lastBeep) }}
                        </div>
                    </div>
                    <span class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-neutral-400">
                        {{ conversation.count }}
                    </span>
                </button>
            </aside>

            <div class="card min-w-0 flex-1 p-4">
                <div class="mb-3 flex items-baseline gap-2 border-b border-white/10 pb-2">
                    <h2 class="font-medium text-white">{{ selectedName }}</h2>
                    <button
                        v-if="thread.length"
                        class="btn ml-auto px-2 py-0.5 text-xs"
                        @click="exportThread"
                    >
                        Export
                    </button>
                    <RouterLink
                        v-if="selected"
                        :to="{ name: 'member', params: { viewer, member: selected } }"
                        class="text-xs text-accent-soft hover:underline"
                        >
profile
</RouterLink
                    >
                </div>
                <div class="space-y-2">
                    <div
                        v-for="{ beep, display } in thread"
                        :key="beep.id"
                        class="flex"
                        :class="beep.direction === 'out' ? 'justify-end' : 'justify-start'"
                    >
                        <div
                            class="max-w-[75%] rounded-lg px-3 py-2"
                            :class="
                                beep.direction === 'out'
                                    ? 'bg-accent/20 text-neutral-100'
                                    : 'bg-surface-2 text-neutral-200'
                            "
                        >
                            <p
                                v-if="display.text"
                                class="text-sm whitespace-pre-wrap"
                                :class="
                                    display.meta?.messageType && display.meta.messageType !== 'Message'
                                        ? 'italic'
                                        : ''
                                "
                                :style="display.meta?.messageColor ? { color: display.meta.messageColor } : undefined"
                            >
                                {{ display.text }}
                            </p>
                            <p v-else class="text-sm text-neutral-500 italic">beep</p>
                            <p class="mt-1 text-[10px] text-neutral-500">
                                {{ formatTime(beep.created) }}
                                <template v-if="beep.roomName"> · from {{ beep.roomName }}</template>
                            </p>
                        </div>
                    </div>
                </div>

                <form
                    v-if="selected"
                    class="mt-4 border-t border-white/10 pt-3"
                    @submit.prevent="sendBeep"
                >
                    <div class="flex gap-2">
                        <input
                            v-model="draft"
                            class="input flex-1"
                            :disabled="!session.viewerOnline || sending"
                            :placeholder="
                                session.viewerOnline
                                    ? `Beep ${selectedName}… (only reaches friends)`
                                    : 'Your character must be online to send beeps'
                            "
                        />
                        <button
                            type="submit"
                            class="btn btn-accent"
                            :disabled="!session.viewerOnline || sending || !draft.trim()"
                        >
                            {{ sending ? 'Sending…' : 'Send' }}
                        </button>
                    </div>
                    <p v-if="sendError" class="mt-2 text-xs text-red-400">{{ sendError }}</p>
                </form>
            </div>
        </div>
    </div>
</template>
