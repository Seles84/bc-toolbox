/**
 * Content-script relay. Two jobs:
 *   1. Inject the page-world mod (injected.js) into the game page.
 *   2. Shuttle envelopes between the page (window.postMessage) and the
 *      background service worker (chrome.runtime port), reconnecting the
 *      port whenever the worker goes to sleep.
 */
import {
    PORT_NAME,
    RELAY_SOURCE,
    isPageEnvelope,
    type PageMessage,
    type RelayEnvelope,
    type ToPageMessage,
} from '@/shared/protocol';

const SCRIPT_ID = 'bct-injected-script';

let port: chrome.runtime.Port | null = null;
const pending: PageMessage[] = [];

function connect(): chrome.runtime.Port | null {
    if (port) {
        return port;
    }
    try {
        port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
        // Extension was reloaded/removed; this content script is orphaned.
        return null;
    }
    port.onDisconnect.addListener(() => {
        port = null;
    });
    port.onMessage.addListener((message: ToPageMessage) => {
        const envelope: RelayEnvelope = { source: RELAY_SOURCE, message };
        window.postMessage(envelope, window.location.origin);
    });
    return port;
}

function forward(message: PageMessage) {
    const p = connect();
    if (!p) {
        return;
    }
    try {
        p.postMessage(message);
    } catch {
        // Port died between connect and post; retry once on a fresh port.
        port = null;
        pending.push(message);
        flushPending();
    }
}

function flushPending() {
    while (pending.length > 0) {
        const p = connect();
        if (!p) {
            return;
        }
        const message = pending.shift();
        if (!message) {
            return;
        }
        try {
            p.postMessage(message);
        } catch {
            port = null;
            pending.unshift(message);
            return;
        }
    }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isPageEnvelope(event.data)) {
        return;
    }
    forward(event.data.message);
});

function injectPageScript() {
    document.getElementById(SCRIPT_ID)?.remove();
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = () => script.remove();
    (document.head ?? document.documentElement).appendChild(script);
}

connect();
injectPageScript();
