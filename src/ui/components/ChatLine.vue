<script setup lang="ts">
/**
 * Renders one chat log line. Chat/Whisper/Emote use our own structured markup
 * (colored names, distinct styling); Action/Activity/ServerMessage use the
 * line exactly as the game rendered it (`renderedText`, captured at the
 * game's own display step). Older records without renderedText fall back to a
 * best-effort readable rendering of the raw template key.
 */
import { computed } from 'vue';
import type { ChatLogRecord, MemberRecord } from '@/shared/records';

const props = defineProps<{
    line: ChatLogRecord;
    members: Map<number, MemberRecord>;
    /** The character whose log this is — fallback whisper target */
    viewer?: number;
}>();

interface DictionaryEntry {
    Tag?: string;
    Text?: string;
    TextToLookUp?: string;
    MemberNumber?: number;
    SourceCharacter?: number;
    TargetCharacter?: number;
}

const dictionary = computed(() => (props.line.dictionary ?? []) as DictionaryEntry[]);

function nameOf(memberNumber?: number): string {
    if (!memberNumber) return '[Unknown]';
    const member = props.members.get(memberNumber);
    return member ? member.nickname || member.name : `#${memberNumber}`;
}

function colorOf(memberNumber?: number): string {
    return (memberNumber && props.members.get(memberNumber)?.labelColor) || '#ffffff';
}

const senderName = computed(() => props.line.senderName ?? nameOf(props.line.sender));

/**
 * Whisper target, defaulting to the viewing character for incoming whispers
 * stored before capture recorded the implicit target.
 */
const whisperTarget = computed(() => {
    if (props.line.target !== undefined) return props.line.target;
    if (props.viewer !== undefined && props.line.sender !== props.viewer) return props.viewer;
    return undefined;
});

/** Templated line: prefer the game-rendered capture, fall back to heuristics. */
const templatedText = computed(() => {
    if (props.line.renderedText) {
        return props.line.renderedText;
    }
    const sourceNumber =
        dictionary.value.find((d) => d.SourceCharacter !== undefined)?.SourceCharacter ??
        props.line.sender;
    const targetNumber =
        dictionary.value.find((d) => d.TargetCharacter !== undefined)?.TargetCharacter ??
        dictionary.value.find((d) => d.Tag === 'DestinationCharacter')?.MemberNumber ??
        props.line.target;

    let text =
        dictionary.value.find((d) => d.Text && !d.Tag)?.Text ?? splitCamelCase(props.line.message);
    text = text
        .replaceAll('SourceCharacter', nameOf(sourceNumber))
        .replaceAll('DestinationCharacterName', nameOf(targetNumber))
        .replaceAll('DestinationCharacter', nameOf(targetNumber))
        .replaceAll('TargetCharacterName', nameOf(targetNumber))
        .replaceAll('TargetCharacter', nameOf(targetNumber));
    for (const entry of dictionary.value) {
        if (entry.Tag && entry.Text) {
            text = text.replaceAll(entry.Tag, entry.Text);
        }
    }
    return text;
});

function splitCamelCase(value: string): string {
    return value
        .replace(/^(ChatOther|ChatSelf|Action|Activity)-?/, '')
        .replace(/[-_]/g, ' ')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2');
}
</script>

<template>
    <div class="text-sm leading-relaxed">
        <template v-if="line.type === 'Chat'">
            <span class="font-semibold" :style="{ color: colorOf(line.sender) }">{{ senderName }}</span>
            <span class="text-neutral-400">{{ ': ' }}</span>
            <span class="text-neutral-200">{{ line.message }}</span>
        </template>

        <template v-else-if="line.type === 'Whisper'">
            <span class="text-fuchsia-300">
                <span class="font-semibold" :style="{ color: colorOf(line.sender) }">{{ senderName }}</span>
                <span class="text-neutral-500">{{ ' whispers to ' }}</span>
                <span class="font-semibold" :style="{ color: colorOf(whisperTarget) }">{{
                    nameOf(whisperTarget)
                }}</span>
                <span class="text-neutral-500">{{ ': ' }}</span>
                <span>{{ line.message }}</span>
            </span>
        </template>

        <template v-else-if="line.type === 'Emote'">
            <span class="text-sky-200 italic">
                <span>*</span>
                <span class="font-semibold" :style="{ color: colorOf(line.sender) }">{{ senderName }}</span>
                <span>{{ ' ' + line.message + '*' }}</span>
            </span>
        </template>

        <template v-else-if="line.type === 'ServerMessage'">
            <span class="text-amber-200/80 italic">{{ templatedText }}</span>
        </template>

        <template v-else>
            <span class="text-neutral-400 italic">({{ templatedText }})</span>
        </template>
    </div>
</template>
