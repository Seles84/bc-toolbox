/**
 * BC Toolbox page-world mod. Registers with bondage-club-mod-sdk (so it
 * coexists with FBC/BCX/LSCG etc.), captures game traffic off ServerSocket,
 * and bridges to the content relay via window.postMessage envelopes.
 */
import bcModSdk from 'bondage-club-mod-sdk';
import {
    PAGE_SOURCE,
    isRelayEnvelope,
    type PageDataRequest,
    type PageEnvelope,
    type PageMessage,
} from '@/shared/protocol';
import { buildProfile } from './profile';
import { initOverlay } from './overlay';
import { runQuery } from './queries';

/**
 * Server → client socket events worth persisting. Chat messages are NOT
 * captured here — they're taken from the ChatRoomMessageDisplay hook instead,
 * which also covers the player's own whispers and other mods' custom lines.
 */
const SERVER_EVENTS = new Set([
    'LoginResponse',
    'ChatRoomSync',
    'ChatRoomSyncSingle',
    'ChatRoomSyncCharacter',
    'ChatRoomSyncMemberJoin',
    'ChatRoomSyncMemberLeave',
    'AccountBeep',
    'AccountQueryResult',
]);

/** Client → server socket events worth persisting. */
const CLIENT_EVENTS = new Set(['ChatRoomLeave', 'AccountBeep']);

/**
 * CommonDrawAppearanceBuild fires when the canvas STARTS rebuilding; the layer
 * images load asynchronously, so wait before reading the canvas or it comes
 * out blank/partial.
 */
const APPEARANCE_SETTLE_DELAY = 1_000;

/** Minimum ms between appearance captures per member. */
const APPEARANCE_THROTTLE = 10_000;

/**
 * How often to ask the server for the online-friends list. The game itself
 * only queries while the friend list screen is open; this matches that
 * screen's refresh cadence, so it adds no unusual server load.
 */
const FRIENDS_POLL_INTERVAL = 45_000;

declare global {
    interface Window {
        BCT_VERSION?: string;
    }
}

if (window.BCT_VERSION) {
    // A previous copy of the mod is still hooked in (page-world scripts can't
    // be unloaded). Tell the extension so the UI can ask for a tab refresh —
    // the old copy may not speak the current protocol.
    console.warn('[BCT] an older BC Toolbox script is still active — refresh this tab to update');
    window.postMessage(
        {
            source: PAGE_SOURCE,
            message: { kind: 'mod-loaded', version: __BCT_VERSION__, build: __BCT_BUILD__, stale: true },
        } satisfies PageEnvelope,
        window.location.origin,
    );
} else {
    window.BCT_VERSION = __BCT_VERSION__;
    boot();
}

function boot() {
    // NOTE: short name must not collide with other mods — Dutchie322's
    // "Bondage Club Tools" extension already registers as 'BCT'.
    const mod = bcModSdk.registerMod({
        name: 'BCToolbox',
        fullName: 'BC Toolbox',
        version: __BCT_VERSION__,
        repository: 'https://github.com/seles84/bc-toolbox',
    });

    const appearanceSentAt = new Map<number, number>();
    const appearancePending = new Map<number, ReturnType<typeof setTimeout>>();
    let socketAttached: unknown = null;

    function send(message: PageMessage) {
        const envelope: PageEnvelope = { source: PAGE_SOURCE, message };
        window.postMessage(envelope, window.location.origin);
    }

    function sendGameEvent(direction: 'server' | 'client', event: string, args: unknown[]) {
        send({
            kind: 'game-event',
            direction,
            event,
            // Almost every BC socket event carries a single payload object.
            data: sanitize(args.length === 1 ? args[0] : args),
            timestamp: Date.now(),
        });
    }

    /** Socket payloads are JSON-safe server data, but never trust that fully. */
    function sanitize(value: unknown): unknown {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return undefined;
        }
    }

    // -- Socket capture ------------------------------------------------------

    const onServerEvent = (event: string, ...args: unknown[]) => {
        if (SERVER_EVENTS.has(event)) {
            sendGameEvent('server', event, args);
        }
    };

    const onClientEvent = (event: string | symbol, ...args: unknown[]) => {
        if (typeof event === 'string' && CLIENT_EVENTS.has(event)) {
            sendGameEvent('client', event, args);
        }
    };

    function attachSocket() {
        // socket.io v4 catch-all listeners; typed loosely because bc-stubs
        // pins whatever socket.io version the game currently bundles.
        const socket = ServerSocket as unknown as {
            onAny(fn: (event: string, ...args: unknown[]) => void): void;
            offAny(fn: (event: string, ...args: unknown[]) => void): void;
            prependAnyOutgoing?(fn: (event: string | symbol, ...args: unknown[]) => void): void;
            offAnyOutgoing?(fn: (event: string | symbol, ...args: unknown[]) => void): void;
        };
        if (!socket || socketAttached === socket) {
            return;
        }
        socketAttached = socket;
        socket.offAny(onServerEvent);
        socket.onAny(onServerEvent);
        socket.offAnyOutgoing?.(onClientEvent);
        socket.prependAnyOutgoing?.(onClientEvent);
        console.info('[BCT] socket listeners attached');
    }

    // The game (re)creates ServerSocket in ServerInit — reattach after it.
    mod.hookFunction('ServerInit', 0, (args, next) => {
        const result = next(args);
        attachSocket();
        return result;
    });

    // Already mid-session when the mod loaded (e.g. extension reload)?
    if (typeof ServerSocket !== 'undefined' && ServerSocket) {
        attachSocket();
    }

    // -- Login / logout ------------------------------------------------------

    mod.hookFunction('LoginResponse', 0, (args, next) => {
        const result = next(args);
        // Player is populated synchronously by LoginResponse on success.
        if (Player?.MemberNumber && Player.MemberNumber > 0) {
            const profile = buildProfile(Player, false);
            if (profile) {
                send({ kind: 'session', state: 'login', player: profile });
            }
        }
        return result;
    });

    // Mod loaded into an already-logged-in game (extension reloaded mid-play).
    if (typeof Player !== 'undefined' && Player?.MemberNumber && Player.MemberNumber > 0) {
        const profile = buildProfile(Player, true);
        if (profile) {
            send({ kind: 'session', state: 'login', player: profile });
        }
    }

    // -- Appearance capture --------------------------------------------------

    mod.hookFunction('CommonDrawAppearanceBuild', 0, (args, next) => {
        const result = next(args);
        const character = args[0];
        const member = character?.MemberNumber;
        if (
            member &&
            member > 0 &&
            !appearancePending.has(member) &&
            Date.now() - (appearanceSentAt.get(member) ?? 0) > APPEARANCE_THROTTLE
        ) {
            // Give the async layer images time to land on the canvas.
            appearancePending.set(
                member,
                setTimeout(() => {
                    appearancePending.delete(member);
                    const profile = buildProfile(character, true);
                    // Blank canvas → no appearanceImage; retry on the next draw.
                    if (profile?.appearanceImage) {
                        appearanceSentAt.set(member, Date.now());
                        send({ kind: 'appearance', profile, timestamp: Date.now() });
                    }
                }, APPEARANCE_SETTLE_DELAY),
            );
        }
        return result;
    });

    // -- Online friends polling ----------------------------------------------

    // The AccountQueryResult response lands in the SERVER_EVENTS capture.
    function pollOnlineFriends() {
        try {
            if (Player?.MemberNumber && Player.MemberNumber > 0) {
                ServerSend('AccountQuery', { Query: 'OnlineFriends' });
            }
        } catch {
            // Socket not ready — the next tick will retry.
        }
    }
    setInterval(pollOnlineFriends, FRIENDS_POLL_INTERVAL);
    setTimeout(pollOnlineFriends, 5_000);

    // -- Chat capture --------------------------------------------------------

    // ChatRoomMessageDisplay puts a message into the chat log; its `msg`
    // argument is the final display text — dictionary substitutions, pronouns
    // and translations already applied by the game. High priority = our hook
    // wraps every other mod's, so `msg` includes their transformations
    // (BCX custom actions etc.) too.
    mod.hookFunction('ChatRoomMessageDisplay', 100, (args, next) => {
        try {
            const [data, msg, , metadata] = args;
            if (data && typeof data.Sender === 'number' && data.Type) {
                send({
                    kind: 'chat-line',
                    line: {
                        sender: data.Sender,
                        senderName: metadata?.senderName,
                        type: data.Type,
                        content: data.Content ?? '',
                        dictionary: sanitize(data.Dictionary) as unknown[] | undefined,
                        // Plain whispers carry the target on the message itself,
                        // not in the extracted metadata.
                        target:
                            metadata?.TargetMemberNumber ??
                            (typeof data.Target === 'number' ? data.Target : undefined),
                        rendered: typeof msg === 'string' && msg.trim() ? msg.trim() : undefined,
                    },
                    timestamp: Date.now(),
                });
            }
        } catch (error) {
            console.warn('[BCT] chat-line capture failed', error);
        }
        return next(args);
    });

    // -- Data requests (page → background database) --------------------------

    const pendingData = new Map<string, (result: unknown) => void>();

    function requestData(request: PageDataRequest): Promise<unknown> {
        return new Promise((resolve) => {
            const id = crypto.randomUUID();
            const timer = setTimeout(() => {
                pendingData.delete(id);
                resolve(null);
            }, 5_000);
            pendingData.set(id, (result) => {
                clearTimeout(timer);
                pendingData.delete(id);
                resolve(result);
            });
            send({ kind: 'data-request', id, request });
        });
    }

    initOverlay(mod, requestData);

    // -- Query bridge (background → page) ------------------------------------

    window.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (event.source !== window || !isRelayEnvelope(event.data)) {
            return;
        }
        const { message } = event.data;
        if (message.kind === 'query') {
            void runQuery(message.query)
                .catch((error): { success: false; error: string } => ({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                }))
                .then((result) => send({ kind: 'query-result', id: message.id, result }));
        } else if (message.kind === 'data-response') {
            pendingData.get(message.id)?.(message.result);
        }
    });

    send({ kind: 'mod-loaded', version: __BCT_VERSION__, build: __BCT_BUILD__ });
    console.info(`[BCT] BC Toolbox v${__BCT_VERSION__} loaded`);
}
