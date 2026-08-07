<script setup lang="ts">
/**
 * Pan/zoomable SVG rendering of the owner/lover network around a member.
 * Solid edges = ownership (grey on trial, white collared), dashed = lovers
 * (red dating, purple engaged, cyan married). Click a node to open them.
 * Look and layout are configurable via the Style panel (persisted globally).
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
    buildRelationshipGraph,
    type GraphNode,
    type RelationshipGraph,
} from '../utils/relationshipGraph';
import { useGraphStyleStore } from '../stores/graphStyle';

const props = defineProps<{
    focal: number;
    depth: number;
    viewer: number;
    /** Highlight the shortest connection from focal to this member */
    pathTarget?: number;
}>();

const emit = defineEmits<{ pathResult: [found: boolean | undefined] }>();

const router = useRouter();
const style = useGraphStyleStore();
const graph = ref<RelationshipGraph | null>(null);
const loading = ref(false);
const showStyle = ref(false);

const container = ref<HTMLDivElement>();
const view = ref({ x: 0, y: 0, scale: 1 });

const SPACING = { compact: 0.55, normal: 1, roomy: 1.6 } as const;

// Portrait nodes are a little larger to fit the avatar next to the text.
const nodeW = computed(() => (style.portraits ? 176 : 156));
const nodeH = computed(() => (style.portraits ? 58 : 46));

watch(
    () => [
        props.focal,
        props.depth,
        props.pathTarget,
        style.orientation,
        style.spacing,
        style.portraits,
    ],
    async () => {
        loading.value = true;
        try {
            graph.value = await buildRelationshipGraph(props.focal, props.depth, props.pathTarget, {
                nodeW: nodeW.value,
                nodeH: nodeH.value,
                orientation: style.orientation,
                spacing: SPACING[style.spacing],
                portraits: style.portraits,
            });
            emit('pathResult', graph.value.pathFound);
            fit();
        } catch (error) {
            console.error('[BCT] relationship graph build failed', error);
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

/** Ownership edge: parent's bottom/right side to child's top/left side. */
function ownsPath(from: GraphNode, to: GraphNode): string {
    const w = nodeW.value;
    const h = nodeH.value;
    if (style.orientation === 'horizontal') {
        const x1 = from.x + w;
        const y1 = from.y + h / 2;
        const x2 = to.x;
        const y2 = to.y + h / 2;
        if (style.edges === 'straight') return `M ${x1} ${y1} L ${x2} ${y2}`;
        const mx = (x1 + x2) / 2;
        return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    }
    const x1 = from.x + w / 2;
    const y1 = from.y + h;
    const x2 = to.x + w / 2;
    const y2 = to.y;
    if (style.edges === 'straight') return `M ${x1} ${y1} L ${x2} ${y2}`;
    const my = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

/** Lover edge: center to center, arcing away from the tree flow when curved. */
function lovesPath(from: GraphNode, to: GraphNode): string {
    const x1 = from.x + nodeW.value / 2;
    const y1 = from.y + nodeH.value / 2;
    const x2 = to.x + nodeW.value / 2;
    const y2 = to.y + nodeH.value / 2;
    if (style.edges === 'straight') return `M ${x1} ${y1} L ${x2} ${y2}`;
    if (style.orientation === 'horizontal') {
        const bend = 40 + Math.abs(y2 - y1) * 0.08;
        return `M ${x1} ${y1} C ${x1 - bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    }
    const bend = 40 + Math.abs(x2 - x1) * 0.08;
    return `M ${x1} ${y1} C ${x1} ${y1 - bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

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
            const path = edge.type === 'owns' ? ownsPath(from, to) : lovesPath(from, to);
            return { ...edge, path, color, dashed: edge.type === 'loves' };
        }),
    };
});

function truncate(label: string): string {
    const max = style.portraits ? 15 : 20;
    return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

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
                <defs>
                    <!-- userSpaceOnUse resolves inside each node's translated <g> -->
                    <clipPath id="bct-graph-portrait" clipPathUnits="userSpaceOnUse">
                        <rect x="5" y="5" width="34" height="48" rx="4" />
                    </clipPath>
                </defs>
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
                            :width="nodeW"
                            :height="nodeH"
                            rx="8"
                            :fill="node.id === focal ? 'rgba(16,185,129,0.18)' : node.onPath ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.05)'"
                            :stroke="node.id === focal || node.onPath ? '#34d399' : node.known ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)'"
                            :stroke-width="node.id === focal || node.onPath ? 2 : 1"
                            :stroke-dasharray="node.known ? undefined : '4 3'"
                        />
                        <template v-if="style.portraits">
                            <rect x="5" y="5" width="34" height="48" rx="4" fill="rgba(255,255,255,0.04)" />
                            <image
                                v-if="node.image"
                                :href="node.image"
                                x="5"
                                y="5"
                                width="34"
                                height="48"
                                preserveAspectRatio="xMidYMin slice"
                                clip-path="url(#bct-graph-portrait)"
                            />
                            <text
                                v-else
                                x="22"
                                :y="nodeH / 2"
                                text-anchor="middle"
                                dominant-baseline="middle"
                                fill="#525252"
                                font-size="16"
                            >
                                ?
                            </text>
                            <text
                                x="46"
                                :y="nodeH / 2 - 3"
                                dominant-baseline="middle"
                                :fill="node.color || '#e5e5e5'"
                                font-size="13"
                                font-weight="600"
                            >
                                {{ truncate(node.label) }}
                            </text>
                            <text x="46" :y="nodeH / 2 + 13" fill="#737373" font-size="10">
                                {{ node.id > 0 ? `#${node.id}` : 'not met' }}
                            </text>
                        </template>
                        <template v-else>
                            <text
                                :x="nodeW / 2"
                                :y="nodeH / 2 - 2"
                                text-anchor="middle"
                                dominant-baseline="middle"
                                :fill="node.color || '#e5e5e5'"
                                font-size="13"
                                font-weight="600"
                            >
                                {{ truncate(node.label) }}
                            </text>
                            <text
                                :x="nodeW / 2"
                                :y="nodeH / 2 + 14"
                                text-anchor="middle"
                                fill="#737373"
                                font-size="10"
                            >
                                {{ node.id > 0 ? `#${node.id}` : 'not met' }}
                            </text>
                        </template>
                    </g>
                </g>
            </svg>

            <div
                v-if="loading"
                class="absolute inset-0 flex items-center justify-center bg-surface/60 text-sm text-neutral-400"
            >
                Building graph…
            </div>

            <div class="absolute top-2 right-2 flex gap-1.5">
                <button
                    class="btn px-2 py-1 text-xs"
                    :class="showStyle ? 'bg-white/10' : ''"
                    title="Graph style"
                    @pointerdown.stop
                    @click.stop="showStyle = !showStyle"
                >
                    Style
                </button>
                <button
                    class="btn px-2 py-1 text-xs"
                    title="Reset view"
                    @pointerdown.stop
                    @click.stop="fit"
                >
                    Fit
                </button>
            </div>

            <div
                v-if="showStyle"
                class="absolute top-10 right-2 z-10 w-52 space-y-2 rounded-lg border border-white/10 bg-surface p-3 shadow-xl"
                @pointerdown.stop
                @wheel.stop
            >
                <label class="flex items-center justify-between gap-2 text-xs text-neutral-400">
                    Layout
                    <select v-model="style.orientation" class="input w-28 py-0.5 text-xs">
                        <option value="vertical">Top-down</option>
                        <option value="horizontal">Sideways</option>
                    </select>
                </label>
                <label class="flex items-center justify-between gap-2 text-xs text-neutral-400">
                    Spacing
                    <select v-model="style.spacing" class="input w-28 py-0.5 text-xs">
                        <option value="compact">Compact</option>
                        <option value="normal">Normal</option>
                        <option value="roomy">Roomy</option>
                    </select>
                </label>
                <label class="flex items-center justify-between gap-2 text-xs text-neutral-400">
                    Edges
                    <select v-model="style.edges" class="input w-28 py-0.5 text-xs">
                        <option value="curved">Curved</option>
                        <option value="straight">Straight</option>
                    </select>
                </label>
                <label class="flex items-center justify-between gap-2 text-xs text-neutral-400">
                    Portraits
                    <input v-model="style.portraits" type="checkbox" class="accent-accent" />
                </label>
            </div>
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
