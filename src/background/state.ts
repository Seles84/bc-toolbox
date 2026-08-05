/**
 * Per-game-tab state. Held in memory while the service worker lives and
 * mirrored to chrome.storage.session so a worker restart mid-play doesn't
 * lose the session/channel being recorded.
 */
import type {
    OnlineFriendInfo,
    PageQuery,
    PageQueryResult,
    TabStatus,
    ToPageMessage,
} from '@/shared/protocol';

export interface TabState {
    tabId: number;
    port: chrome.runtime.Port | null;
    modLoaded: boolean;
    /** Injected script in this tab predates the current extension build */
    needsRefresh: boolean;
    friends?: OnlineFriendInfo[];
    friendsUpdated?: number;
    /** Capture paused for this tab (persisted across worker restarts) */
    capturePaused?: boolean;
    /** Current room is private and the skip-private-rooms rule applies */
    roomPrivate?: boolean;
    memberNumber?: number;
    characterName?: string;
    sessionId?: string;
    channelId?: number;
    roomName?: string;
    /** In-flight page queries keyed by request id */
    pendingQueries: Map<string, (result: PageQueryResult) => void>;
}

const tabs = new Map<number, TabState>();

const STORAGE_PREFIX = 'tabState:';

type PersistedTabState = Pick<
    TabState,
    'memberNumber' | 'characterName' | 'sessionId' | 'channelId' | 'roomName' | 'capturePaused'
>;

export async function getTab(tabId: number): Promise<TabState> {
    let state = tabs.get(tabId);
    if (!state) {
        state = { tabId, port: null, modLoaded: false, needsRefresh: false, pendingQueries: new Map() };
        tabs.set(tabId, state);
        const stored = await chrome.storage.session.get(STORAGE_PREFIX + tabId);
        const persisted = stored[STORAGE_PREFIX + tabId] as PersistedTabState | undefined;
        if (persisted) {
            Object.assign(state, persisted);
        }
    }
    return state;
}

export async function persistTab(state: TabState): Promise<void> {
    const persisted: PersistedTabState = {
        memberNumber: state.memberNumber,
        characterName: state.characterName,
        sessionId: state.sessionId,
        channelId: state.channelId,
        roomName: state.roomName,
        capturePaused: state.capturePaused,
    };
    await chrome.storage.session.set({ [STORAGE_PREFIX + state.tabId]: persisted });
}

export async function removeTab(tabId: number): Promise<void> {
    tabs.delete(tabId);
    await chrome.storage.session.remove(STORAGE_PREFIX + tabId);
}

export function allTabs(): TabState[] {
    return [...tabs.values()];
}

export function findTabByMember(memberNumber: number): TabState | undefined {
    return allTabs().find((t) => t.memberNumber === memberNumber);
}

export function statusOf(state: TabState): TabStatus {
    return {
        tabId: state.tabId,
        memberNumber: state.memberNumber,
        characterName: state.characterName,
        sessionId: state.sessionId,
        channelId: state.channelId,
        roomName: state.roomName,
        modLoaded: state.modLoaded,
        needsRefresh: state.needsRefresh,
        friends: state.friends,
        friendsUpdated: state.friendsUpdated,
        capturePaused: state.capturePaused,
        roomPrivate: state.roomPrivate,
    };
}

/** Send a query into the page and await its response. */
export function queryPage(
    state: TabState,
    query: PageQuery,
    // Generous: the wardrobe query can spend ~10s driving canvas rebuilds
    // while asset images download.
    timeoutMs = 25_000,
): Promise<PageQueryResult> {
    return new Promise((resolve) => {
        if (!state.port) {
            resolve({ success: false, error: 'Game tab is not connected' });
            return;
        }
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
            state.pendingQueries.delete(id);
            resolve({ success: false, error: 'Query timed out' });
        }, timeoutMs);
        state.pendingQueries.set(id, (result) => {
            clearTimeout(timer);
            state.pendingQueries.delete(id);
            resolve(result);
        });
        const message: ToPageMessage = { kind: 'query', id, query };
        try {
            state.port.postMessage(message);
        } catch {
            clearTimeout(timer);
            state.pendingQueries.delete(id);
            resolve({ success: false, error: 'Failed to reach game tab' });
        }
    });
}
