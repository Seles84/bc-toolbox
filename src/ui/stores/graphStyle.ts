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
/** What each node card shows: text, avatar, or both (side by side / stacked) */
export type GraphNodeStyle = 'name' | 'portrait' | 'left' | 'top';

export interface GraphStyleSettings {
    orientation: GraphOrientation;
    spacing: GraphSpacing;
    edges: GraphEdgeStyle;
    nodeStyle: GraphNodeStyle;
}

const DEFAULTS: GraphStyleSettings = {
    orientation: 'vertical',
    spacing: 'normal',
    edges: 'curved',
    nodeStyle: 'left',
};

export const useGraphStyleStore = defineStore('graphStyle', () => {
    const orientation = ref<GraphOrientation>(DEFAULTS.orientation);
    const spacing = ref<GraphSpacing>(DEFAULTS.spacing);
    const edges = ref<GraphEdgeStyle>(DEFAULTS.edges);
    const nodeStyle = ref<GraphNodeStyle>(DEFAULTS.nodeStyle);

    let loaded = false;
    let applying = false;

    function apply(
        stored: (Partial<GraphStyleSettings> & { portraits?: boolean }) | undefined,
    ) {
        applying = true;
        orientation.value = stored?.orientation ?? DEFAULTS.orientation;
        spacing.value = stored?.spacing ?? DEFAULTS.spacing;
        edges.value = stored?.edges ?? DEFAULTS.edges;
        // Migrate the old boolean portraits setting.
        nodeStyle.value =
            stored?.nodeStyle ?? (stored?.portraits === false ? 'name' : DEFAULTS.nodeStyle);
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

    watch([orientation, spacing, edges, nodeStyle], () => {
        if (loaded && !applying) {
            void chrome.storage.local.set({
                graphStyle: {
                    orientation: orientation.value,
                    spacing: spacing.value,
                    edges: edges.value,
                    nodeStyle: nodeStyle.value,
                } satisfies GraphStyleSettings,
            });
        }
    });

    return { orientation, spacing, edges, nodeStyle };
});
