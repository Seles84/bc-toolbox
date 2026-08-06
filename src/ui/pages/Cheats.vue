<script setup lang="ts">
/**
 * Cheats for the player's own character: money, skill levels and reputation,
 * applied through the game's own change functions (which handle validation
 * and the server push). Requires the character live in a game tab.
 */
import { computed, onMounted, ref, watch } from 'vue';
import type { PlayerStats } from '@/shared/protocol';
import { api } from '../api';
import { useCheatsStore } from '../stores/cheats';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const cheats = useCheatsStore();

const stats = ref<PlayerStats | null>(null);
const loading = ref(false);
const error = ref('');
const busy = ref(false);

const SKILL_LABELS: Record<string, string> = {
    Bondage: 'Bondage',
    SelfBondage: 'Self bondage',
    LockPicking: 'Lock picking',
    Evasion: 'Evasion',
    Willpower: 'Willpower',
    Infiltration: 'Infiltration',
    Dressage: 'Dressage',
};
const REP_LABELS: Record<string, string> = {
    Dominant: 'Dominant / Submissive',
    Kidnap: 'Kidnapping',
    ABDL: 'ABDL',
    Gaming: 'Gaming',
    Maid: 'Maid',
    LARP: 'LARP',
    Asylum: 'Asylum',
    Gambling: 'Gambling',
    HouseMaiestas: 'House Maiestas',
    HouseVincula: 'House Vincula',
    HouseAmplector: 'House Amplector',
    HouseCorporis: 'House Corporis',
};

const moneyInput = ref<number | null>(null);
const skillInputs = ref<Record<string, number>>({});
const repInputs = ref<Record<string, number>>({});

async function query(q: Parameters<typeof buildQuery>[0]): Promise<unknown> {
    const result = await api('page.query', {
        memberNumber: session.viewer!,
        query: buildQuery(q),
    });
    if (!result.success) {
        throw new Error(result.error);
    }
    return result.data;
}

// Narrow helper so the call sites above stay tidy.
function buildQuery(
    q:
        | { type: 'player-stats' }
        | { type: 'cheat-money'; amount: number }
        | { type: 'cheat-skill'; skill: string; level: number }
        | { type: 'cheat-reputation'; rep: string; value: number },
) {
    return q;
}

async function load() {
    if (!cheats.enabled || !session.viewerOnline) {
        stats.value = null;
        return;
    }
    loading.value = true;
    error.value = '';
    try {
        const data = (await query({ type: 'player-stats' })) as PlayerStats;
        stats.value = data;
        moneyInput.value = data.money;
        skillInputs.value = Object.fromEntries(data.skills.map((s) => [s.type, s.level]));
        repInputs.value = Object.fromEntries(data.reputation.map((r) => [r.type, r.value]));
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
        stats.value = null;
    } finally {
        loading.value = false;
    }
}

async function run(action: () => Promise<void>) {
    busy.value = true;
    error.value = '';
    try {
        await action();
        await load();
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        busy.value = false;
    }
}

function setMoney() {
    const amount = moneyInput.value;
    if (amount === null || !Number.isFinite(amount)) return;
    void run(async () => {
        await query({ type: 'cheat-money', amount });
    });
}

function addMoney(delta: number) {
    void run(async () => {
        await query({ type: 'cheat-money', amount: (stats.value?.money ?? 0) + delta });
    });
}

function setSkill(skill: string) {
    void run(async () => {
        await query({ type: 'cheat-skill', skill, level: skillInputs.value[skill] ?? 0 });
    });
}

function maxAllSkills() {
    void run(async () => {
        for (const s of stats.value?.skills ?? []) {
            await query({ type: 'cheat-skill', skill: s.type, level: 10 });
        }
    });
}

function setReputation(rep: string) {
    void run(async () => {
        await query({ type: 'cheat-reputation', rep, value: repInputs.value[rep] ?? 0 });
    });
}

const skillDirty = computed(() => (type: string, level: number) =>
    (skillInputs.value[type] ?? 0) !== level,
);
const repDirty = computed(() => (type: string, value: number) =>
    (repInputs.value[type] ?? 0) !== value,
);

watch(
    () => [session.viewer, session.viewerOnline, cheats.enabled],
    () => void load(),
);
onMounted(() => void load());
</script>

<template>
    <div class="mx-auto max-w-3xl">
        <div class="mb-4 flex items-center gap-3">
            <h1 class="text-xl font-semibold text-white">Cheats</h1>
            <button v-if="stats" class="btn ml-auto px-2.5 py-1 text-xs" :disabled="loading || busy" @click="load">
                {{ loading ? 'Refreshing…' : 'Refresh' }}
            </button>
        </div>
        <p class="mb-4 text-sm text-neutral-500">
            Changes apply to
            <span class="text-neutral-300">{{ session.viewerName ?? 'your character' }}</span>
            instantly and are saved to the server by the game itself.
        </p>

        <div v-if="error" class="card mb-4 border border-rose-500/30 p-3 text-sm text-rose-300">
            {{ error }}
        </div>

        <div v-if="!cheats.enabled" class="card p-6 text-center text-sm text-neutral-400">
            Cheats are turned off — enable them in
            <RouterLink to="/settings" class="text-accent-soft hover:text-accent">Settings</RouterLink>.
        </div>

        <div v-else-if="!session.viewerOnline" class="card p-6 text-center text-sm text-neutral-400">
            This character isn't online in a game tab — log in to use cheats.
        </div>

        <template v-else-if="stats">
            <div class="card mb-4 p-5">
                <h2 class="mb-1 font-medium text-white">Reveals</h2>
                <label class="flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                    <input v-model="cheats.showLockCodes" type="checkbox" class="accent-accent" />
                    Show passwords on restraints
                    <span class="text-xs text-neutral-600">
                        (password/combination locks on the Wearing tab of member profiles)</span
                    >
                </label>
            </div>

            <div class="card mb-4 p-5">
                <h2 class="mb-1 font-medium text-white">Money</h2>
                <p class="mb-3 text-sm text-neutral-500">
                    Currently <span class="font-medium text-emerald-300">${{ stats.money.toLocaleString() }}</span>
                </p>
                <div class="flex flex-wrap items-center gap-2">
                    <input
                        v-model.number="moneyInput"
                        type="number"
                        min="0"
                        max="99999999"
                        class="input w-36"
                        :disabled="busy"
                        @keyup.enter="setMoney"
                    />
                    <button class="btn btn-accent" :disabled="busy" @click="setMoney">Set</button>
                    <span class="mx-1 text-neutral-700">·</span>
                    <button class="btn" :disabled="busy" @click="addMoney(1_000)">+1,000</button>
                    <button class="btn" :disabled="busy" @click="addMoney(10_000)">+10,000</button>
                    <button class="btn" :disabled="busy" @click="addMoney(100_000)">+100,000</button>
                </div>
            </div>

            <div class="card mb-4 p-5">
                <div class="mb-3 flex items-center gap-3">
                    <h2 class="font-medium text-white">Skills</h2>
                    <button class="btn ml-auto text-xs" :disabled="busy" @click="maxAllSkills">
                        Max all
                    </button>
                </div>
                <div class="space-y-2">
                    <div
                        v-for="skill in stats.skills"
                        :key="skill.type"
                        class="flex items-center gap-3 text-sm"
                    >
                        <span class="w-28 shrink-0 text-neutral-300">
                            {{ SKILL_LABELS[skill.type] ?? skill.type }}
                        </span>
                        <span class="w-16 shrink-0 text-xs text-neutral-500">
                            Lv {{ skill.level }}
                        </span>
                        <input
                            v-model.number="skillInputs[skill.type]"
                            type="range"
                            min="0"
                            max="10"
                            step="1"
                            class="flex-1 accent-accent"
                            :disabled="busy"
                        />
                        <span class="w-6 shrink-0 text-center text-neutral-300">
                            {{ skillInputs[skill.type] }}
                        </span>
                        <button
                            class="btn px-2.5 py-1 text-xs"
                            :disabled="busy || !skillDirty(skill.type, skill.level)"
                            @click="setSkill(skill.type)"
                        >
                            Set
                        </button>
                    </div>
                </div>
                <p class="mt-3 text-xs text-neutral-600">
                    Setting a level restarts that level's progress at 0.
                </p>
            </div>

            <div class="card mb-4 p-5">
                <h2 class="mb-3 font-medium text-white">Reputation</h2>
                <div class="space-y-2">
                    <div
                        v-for="rep in stats.reputation"
                        :key="rep.type"
                        class="flex items-center gap-3 text-sm"
                    >
                        <span class="w-44 shrink-0 text-neutral-300">
                            {{ REP_LABELS[rep.type] ?? rep.type }}
                        </span>
                        <span class="w-10 shrink-0 text-right text-xs text-neutral-500">
                            {{ rep.value }}
                        </span>
                        <input
                            v-model.number="repInputs[rep.type]"
                            type="range"
                            min="-100"
                            max="100"
                            step="1"
                            class="flex-1 accent-accent"
                            :disabled="busy"
                        />
                        <span class="w-10 shrink-0 text-center text-neutral-300">
                            {{ repInputs[rep.type] }}
                        </span>
                        <button
                            class="btn px-2.5 py-1 text-xs"
                            :disabled="busy || !repDirty(rep.type, rep.value)"
                            @click="setReputation(rep.type)"
                        >
                            Set
                        </button>
                    </div>
                </div>
                <p class="mt-3 text-xs text-neutral-600">
                    Dominant reputation runs from -100 (fully submissive) to +100 (fully dominant).
                </p>
            </div>
        </template>

        <div v-else-if="loading" class="card p-6 text-center text-sm text-neutral-500">Loading…</div>
    </div>
</template>
