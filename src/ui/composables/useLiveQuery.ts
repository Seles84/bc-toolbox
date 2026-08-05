/**
 * Vue wrapper around Dexie's liveQuery: the returned ref re-emits whenever
 * any table touched by the querier changes — including writes made by the
 * background service worker (Dexie propagates commits across contexts).
 *
 * `deps` are reactive sources the querier reads (route params, search text…);
 * changing them tears down and resubscribes the query.
 */
import { liveQuery, type Subscription } from 'dexie';
import { onUnmounted, ref, watch, type Ref, type WatchSource } from 'vue';

export function useLiveQuery<T>(
    querier: () => T | Promise<T>,
    deps: WatchSource[],
    initial: T,
): Ref<T> {
    const result = ref(initial) as Ref<T>;
    let subscription: Subscription | null = null;

    function resubscribe() {
        subscription?.unsubscribe();
        subscription = liveQuery(querier).subscribe({
            next: (value) => {
                result.value = value;
            },
            error: (error) => {
                console.error('[BCT] liveQuery error', error);
            },
        });
    }

    if (deps.length > 0) {
        watch(deps, resubscribe, { immediate: true });
    } else {
        resubscribe();
    }

    onUnmounted(() => subscription?.unsubscribe());
    return result;
}
