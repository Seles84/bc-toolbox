/**
 * Relationship-graph style settings: layout orientation, node spacing,
 * edge style, and portrait avatars. Persisted in chrome.storage.local and
 * kept in sync across every open toolbox page via the storage listener.
 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type GraphOrientation = 'vertical' | 'horizontal';
export type GraphSpacing = 'compact' | 'normal' | 'roomy';
export type GraphEdgeStyle = 'curved' | 'straight';

export interface GraphStyleSettings {
    orientation: GraphOrientation;
    spacing: GraphSpacing;
    edges: GraphEdgeStyle;
    portraits: boolean;
}

const DEFAULTS: GraphStyleSettings = {
    orientation: 'vertical',
    spacing: 'normal',
    edges: 'curved',
    portraits: true,
};

export const useGraphStyleStore = defineStore('graphStyle', () => {
    const orientation = ref<GraphOrientation>(DEFAULTS.orientation);
    const spacing = ref<GraphSpacing>(DEFAULTS.spacing);
    const edges = ref<GraphEdgeStyle>(DEFAULTS.edges);
    const portraits = ref(DEFAULTS.portraits);

    let loaded = false;
    let applying = false;

    function apply(stored: Partial<GraphStyleSettings> | undefined) {
        applying = true;
        orientation.value = stored?.orientation ?? DEFAULTS.orientation;
        spacing.value = stored?.spacing ?? DEFAULTS.spacing;
        edges.value = stored?.edges ?? DEFAULTS.edges;
        portraits.value = stored?.portraits ?? DEFAULTS.portraits;
        applying = false;
    }

    void chrome.storage.local.get('graphStyle').then((stored) => {
        apply(stored.graphStyle as Partial<GraphStyleSettings> | undefined);
        loaded = true;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.graphStyle) {
            apply(changes.graphStyle.newValue as Partial<GraphStyleSettings> | undefined);
        }
    });

    watch([orientation, spacing, edges, portraits], () => {
        if (loaded && !applying) {
            void chrome.storage.local.set({
                graphStyle: {
                    orientation: orientation.value,
                    spacing: spacing.value,
                    edges: edges.value,
                    portraits: portraits.value,
                } satisfies GraphStyleSettings,
            });
        }
    });

    return { orientation, spacing, edges, portraits };
});
