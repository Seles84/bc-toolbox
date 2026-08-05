/**
 * Background service worker: accepts relay ports from game tabs, feeds their
 * traffic through the capture layer, and answers API calls from the UI.
 */
import {
    PORT_NAME,
    isApiRequest,
    type ApiEndpoints,
    type ApiRequest,
    type ApiResponse,
    type PageMessage,
} from '@/shared/protocol';
import { handlePageMessage, storeCapturedProfile } from './capture';
import { initBackups } from './backup';
import { allTabs, findTabByMember, getTab, queryPage, removeTab, statusOf } from './state';

// -- Relay ports from game tabs ---------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) {
        return;
    }
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined) {
        port.disconnect();
        return;
    }

    void getTab(tabId).then((state) => {
        state.port = port;

        port.onMessage.addListener((message: PageMessage) => {
            void getTab(tabId).then((s) =>
                handlePageMessage(s, message).catch((error) => {
                    console.error('[BCT] capture error', message.kind, error);
                }),
            );
        });

        port.onDisconnect.addListener(() => {
            state.port = null;
        });
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    void removeTab(tabId);
});

// -- API for the UI ----------------------------------------------------------

const handlers: {
    [E in keyof ApiEndpoints]: (params: ApiEndpoints[E]['params']) => Promise<ApiEndpoints[E]['result']>;
} = {
    async ping() {
        return { now: Date.now(), version: __BCT_VERSION__ };
    },

    async 'tabs.status'() {
        return allTabs().map(statusOf);
    },

    async 'page.query'({ memberNumber, query }) {
        const tab = findTabByMember(memberNumber);
        if (!tab) {
            return { success: false, error: `No live game tab for member ${memberNumber}` };
        }
        const result = await queryPage(tab, query);
        // Freshly pulled profiles go straight into the database.
        if (result.success && query.type === 'character-data') {
            await storeCapturedProfile(result.data as import('@/shared/protocol').CapturedProfile).catch(
                (error) => console.error('[BCT] failed to store pulled profile', error),
            );
        }
        return result;
    },
};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isApiRequest(message)) {
        return false;
    }
    void dispatch(message).then(sendResponse);
    return true; // keep the response channel open for the async result
});

async function dispatch(request: ApiRequest): Promise<ApiResponse> {
    try {
        const handler = handlers[request.endpoint] as (params: unknown) => Promise<unknown>;
        if (!handler) {
            return { ok: false, error: `Unknown endpoint ${String(request.endpoint)}` };
        }
        const data = await handler(request.params);
        return { ok: true, data } as ApiResponse;
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// -- Notification click → open that member's profile -------------------------

chrome.notifications.onClicked.addListener((id) => {
    const match = id.match(/^bct-friend:(\d+):(\d+)$/);
    if (match) {
        void chrome.tabs.create({
            url: chrome.runtime.getURL(`index.html#/c/${match[1]}/members/${match[2]}`),
        });
        void chrome.notifications.clear(id);
    }
});

initBackups();
