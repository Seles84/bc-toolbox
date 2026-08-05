<script setup lang="ts">
/**
 * Renders a member bio with URLs turned into links and image URLs into inline
 * images. Built from template segments (never v-html) — bios are untrusted
 * member-authored text.
 */
import { computed } from 'vue';

const props = defineProps<{ text: string }>();

type Segment =
    | { kind: 'text'; value: string }
    | { kind: 'link'; url: string }
    | { kind: 'image'; url: string };

const IMAGE_RE = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

const segments = computed<Segment[]>(() =>
    props.text.split(/(\s+)/).map((word): Segment => {
        if (/^https?:\/\/\S+$/i.test(word)) {
            return IMAGE_RE.test(word) ? { kind: 'image', url: word } : { kind: 'link', url: word };
        }
        return { kind: 'text', value: word };
    }),
);
</script>

<template>
    <p class="text-sm leading-relaxed whitespace-pre-wrap text-neutral-300">
        <template v-for="(segment, index) in segments" :key="index">
            <a
                v-if="segment.kind === 'image'"
                :href="segment.url"
                target="_blank"
                rel="noopener noreferrer"
            >
                <img :src="segment.url" alt="" class="my-2 block max-w-full rounded" loading="lazy" />
            </a>
            <a
                v-else-if="segment.kind === 'link'"
                :href="segment.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent-soft underline break-all hover:text-accent"
                >{{ segment.url }}</a
            >
            <template v-else>{{ segment.value }}</template>
        </template>
    </p>
</template>
