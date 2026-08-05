<script setup lang="ts">
/**
 * Pan/zoomable SVG rendering of the owner/lover network around a member.
 * Solid edges = ownership (grey on trial, white collared), dashed = lovers
 * (red dating, purple engaged, cyan married). Click a node to open them.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
    buildRelationshipGraph,
    NODE_H,
    NODE_W,
    type RelationshipGraph,
} from '../utils/relationshipGraph';

const props = defineProps<{
    focal: number;
    depth: number;
    viewer: number;
    /** Highlight the shortest connection from focal to this member */
    pathTarget?: number;
}>();

const emit = defineEmits<{ pathResult: [found: boolean | undefined] }>();

const router = useRouter();
const graph = ref<RelationshipGraph | null>(null);
const loading = ref(false);

const container = ref<HTMLDivElement>();
const view = ref({ x: 0, y: 0, scale: 1 });

watch(
    () => [props.focal, props.depth, props.pathTarget],
    async () => {
        loading.value = true;
        try {
            graph.value = await buildRelationshipGraph(props.focal, props.depth, props.pathTarget);
            emit('pathResult', graph.value.pathFound);
            fit();
        } finally {
            loading.value = false;
        }
    },
    { immediate: true },
);

function fit() {
    const g = graph.value;
    const el = container.value;
    if (!g || !el || g.width === 0) return;
    const cw = el.clientWidth || 800;
    const ch = el.clientHeight || 420;
    const scale = Math.min(1, (cw - 40) / g.width, (ch - 40) / g.height);
    view.value = {
        scale,
        x: (cw - g.width * scale) / 2,
        y: (ch - g.height * scale) / 2,
    };
}

// -- Pan / zoom --------------------------------------------------------------

let dragging = false;
let last = { x: 0, y: 0 };

function onPointerDown(event: PointerEvent) {
    dragging = true;
    last = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    view.value.x += event.clientX - last.x;
    view.value.y += event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
}

function onPointerUp() {
    dragging = false;
}

function onWheel(event: WheelEvent) {
    const el = container.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scale = Math.min(3, Math.max(0.1, view.value.scale * factor));
    const applied = scale / view.value.scale;
    view.value = {
        scale,
        x: px - (px - view.value.x) * applied,
        y: py - (py - view.value.y) * applied,
    };
}

// -- Rendering helpers -------------------------------------------------------

const OWNS_COLORS = ['#9ca3af', '#f5f5f5'];
const LOVES_COLORS = ['#f87171', '#c084fc', '#22d3ee'];

const positioned = computed(() => {
    const g = graph.value;
    if (!g) return { nodes: [], edges: [] };
    const nodeById = new Map(g.nodes.map((n) => [n.id, n]));
    return {
        nodes: g.nodes,
        edges: g.edges.map((edge) => {
            const from = nodeById.get(edge.from)!;
            const to = nodeById.get(edge.to)!;
            const color =
                edge.type === 'owns'
                    ? (OWNS_COLORS[edge.stage] ?? OWNS_COLORS[0])
                    : (LOVES_COLORS[edge.stage] ?? LOVES_COLORS[0]);
            let path: string;
            if (edge.type === 'owns') {
                const x1 = from.x + NODE_W / 2;
                const y1 = from.y + NODE_H;
                const x2 = to.x + NODE_W / 2;
                const y2 = to.y;
                const my = (y1 + y2) / 2;
                path = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
            } else {
                const x1 = from.x + NODE_W / 2;
                const y1 = from.y + NODE_H / 2;
                const x2 = to.x + NODE_W / 2;
                const y2 = to.y + NODE_H / 2;
                const bend = 40 + Math.abs(x2 - x1) * 0.08;
                path = `M ${x1} ${y1} C ${x1} ${y1 - bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
            }
            return { ...edge, path, color, dashed: edge.type === 'loves' };
        }),
    };
});

function openMember(id: number) {
    if (id > 0) {
        void router.push({ name: 'member', params: { viewer: props.viewer, member: id } });
    }
}
</script>

<template>
    <div>
        <div
            ref="container"
            class="relative h-[420px] cursor-grab touch-none overflow-hidden rounded-lg border border-white/10 bg-surface-2/40 active:cursor-grabbing"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @wheel.prevent="onWheel"
        >
            <svg class="h-full w-full select-none">
                <g :transform="`translate(${view.x}, ${view.y}) scale(${view.scale})`">
                    <path
                        v-for="(edge, index) in positioned.edges"
                        :key="index"
                        :d="edge.path"
                        fill="none"
                        :stroke="edge.onPath ? '#34d399' : edge.color"
                        :stroke-width="edge.onPath ? 3 : 1.5"
                        :stroke-dasharray="edge.dashed ? '6 4' : undefined"
                        :opacity="edge.onPath ? 1 : 0.75"
                    />
                    <g
                        v-for="node in positioned.nodes"
                        :key="node.id"
                        :transform="`translate(${node.x}, ${node.y})`"
                        :class="node.id > 0 ? 'cursor-pointer' : ''"
                        @click.stop="openMember(node.id)"
                    >
                        <rect
                            :width="NODE_W"
                            :height="NODE_H"
                            rx="8"
                            :fill="node.id === focal ? 'rgba(16,185,129,0.18)' : node.onPath ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.05)'"
                            :stroke="node.id === focal || node.onPath ? '#34d399' : node.known ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)'"
                            :stroke-width="node.id === focal || node.onPath ? 2 : 1"
                            :stroke-dasharray="node.known ? undefined : '4 3'"
                        />
                        <text
                            :x="NODE_W / 2"
                            :y="NODE_H / 2 - 2"
                            text-anchor="middle"
                            dominant-baseline="middle"
                            :fill="node.color || '#e5e5e5'"
                            font-size="13"
                            font-weight="600"
                        >
                            {{ node.label.length > 20 ? node.label.slice(0, 19) + '…' : node.label }}
                        </text>
                        <text
                            :x="NODE_W / 2"
                            :y="NODE_H / 2 + 14"
                            text-anchor="middle"
                            fill="#737373"
                            font-size="10"
                        >
                            {{ node.id > 0 ? `#${node.id}` : 'not met' }}
                        </text>
                    </g>
                </g>
            </svg>

            <div
                v-if="loading"
                class="absolute inset-0 flex items-center justify-center bg-surface/60 text-sm text-neutral-400"
            >
                Building graph…
            </div>

            <button
                class="btn absolute top-2 right-2 px-2 py-1 text-xs"
                title="Reset view"
                @click.stop="fit"
            >
                Fit
            </button>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
            <span><span class="mr-1 inline-block h-0.5 w-5 align-middle" style="background: #9ca3af"></span>On trial</span>
            <span><span class="mr-1 inline-block h-0.5 w-5 align-middle" style="background: #f5f5f5"></span>Collared</span>
            <span><span class="mr-1 inline-block h-0.5 w-5 border-t-2 border-dashed align-middle" style="border-color: #f87171"></span>Dating</span>
            <span><span class="mr-1 inline-block h-0.5 w-5 border-t-2 border-dashed align-middle" style="border-color: #c084fc"></span>Engaged</span>
            <span><span class="mr-1 inline-block h-0.5 w-5 border-t-2 border-dashed align-middle" style="border-color: #22d3ee"></span>Married</span>
            <span v-if="graph?.truncated" class="text-amber-400">Graph truncated (too many nodes)</span>
        </div>
    </div>
</template>
