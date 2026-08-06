/**
 * Cheat settings: master switch (shows/hides the Cheats page) plus the
 * individual reveals. Persisted in chrome.storage.local and kept in sync
 * across every open toolbox page/popup via the storage listener.
 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface CheatSettings {
    enabled: boolean;
    showLockCodes: boolean;
}

const DEFAULTS: CheatSettings = { enabled: false, showLockCodes: false };

export const useCheatsStore = defineStore('cheats', () => {
    const enabled = ref(DEFAULTS.enabled);
    const showLockCodes = ref(DEFAULTS.showLockCodes);

    let loaded = false;
    let applying = false;

    function apply(stored: Partial<CheatSettings> | undefined) {
        applying = true;
        enabled.value = stored?.enabled ?? DEFAULTS.enabled;
        showLockCodes.value = stored?.showLockCodes ?? DEFAULTS.showLockCodes;
        applying = false;
    }

    void chrome.storage.local.get('cheats').then((stored) => {
        apply(stored.cheats as Partial<CheatSettings> | undefined);
        loaded = true;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.cheats) {
            apply(changes.cheats.newValue as Partial<CheatSettings> | undefined);
        }
    });

    watch([enabled, showLockCodes], () => {
        if (loaded && !applying) {
            void chrome.storage.local.set({
                cheats: { enabled: enabled.value, showLockCodes: showLockCodes.value },
            });
        }
    });

    return { enabled, showLockCodes };
});
