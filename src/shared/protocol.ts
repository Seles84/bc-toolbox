/**
 * The single message protocol used across all four contexts:
 *
 *   [page: injected mod] ⇄ window.postMessage ⇄ [content relay]
 *   [content relay]      ⇄ chrome.runtime port (PORT_NAME) ⇄ [background]
 *   [UI pages]           ⇄ chrome.runtime.sendMessage      ⇄ [background]
 *
 * Every window.postMessage payload is wrapped in an envelope carrying a
 * `source` marker so the relay and mod can ignore everything else on the
 * (very chatty) game window.
 */
import type { MemberRecord } from './records';

export const PAGE_SOURCE = 'bct-page' as const;
export const RELAY_SOURCE = 'bct-relay' as const;
export const PORT_NAME = 'bct-tab' as const;

/** Profile as captured in the page; identical to MemberRecord minus bookkeeping. */
export type CapturedProfile = Omit<MemberRecord, 'isPlayer' | 'capturedAt'> & {
    isPlayer: boolean;
};

// ---------------------------------------------------------------------------
// Page → background (via relay)
// ---------------------------------------------------------------------------

/**
 * One chat line, captured at the game's own display step so `rendered` is the
 * exact text the player saw (dictionary templating, pronouns, translations and
 * other mods' transformations all applied by the game itself).
 */
export interface ChatLinePayload {
    sender: number;
    /** Sender name as resolved by the game (garbled when deafened, etc.) */
    senderName?: string;
    type: string;
    /** Raw message content / template key as it came over the wire */
    content: string;
    /** The game's raw Dictionary payload */
    dictionary?: unknown[];
    /** Whisper/action target, when the game resolved one */
    target?: number;
    /** Final display text of the whole line */
    rendered?: string;
}

/** Data the in-game overlay shows about the character being inspected. */
export interface OverlayMemberInfo {
    met: boolean;
    tags: string[];
    note: string;
    firstSeen?: number;
    lastSeen?: number;
    lastLocation?: string;
    previousNames?: string[];
}

/** Requests the PAGE makes against the extension's database. */
export type PageDataRequest = { type: 'member-overlay'; member: number };

export type PageMessage =
    | { kind: 'mod-loaded'; version: string; build: string; stale?: boolean }
    | { kind: 'session'; state: 'login'; player: CapturedProfile }
    | { kind: 'session'; state: 'logout' }
    | {
          kind: 'game-event';
          direction: 'server' | 'client';
          event: string;
          data: unknown;
          timestamp: number;
      }
    | { kind: 'chat-line'; line: ChatLinePayload; timestamp: number }
    | { kind: 'appearance'; profile: CapturedProfile; timestamp: number }
    | { kind: 'query-result'; id: string; result: PageQueryResult }
    | { kind: 'data-request'; id: string; request: PageDataRequest };

// ---------------------------------------------------------------------------
// Background → page (via relay)
// ---------------------------------------------------------------------------

export type PageQuery =
    | { type: 'character-data'; memberNumber: number }
    | { type: 'player-data' }
    | { type: 'player-wardrobe' }
    | { type: 'room-roster' }
    // Act-as-the-player commands — only ever triggered by an explicit user
    // action in the toolbox UI (typing a message and pressing send).
    | { type: 'send-whisper'; target: number; message: string }
    | { type: 'send-beep'; target: number; message: string }
    | { type: 'wardrobe-rename'; slot: number; name: string }
    | { type: 'wardrobe-clear'; slot: number };

export type PageQueryResult =
    | { success: true; data: unknown }
    | { success: false; error: string };

/** One current room occupant, as returned by the 'room-roster' page query. */
export interface RosterMember {
    memberNumber: number;
    name: string;
    nickname?: string;
    labelColor?: string;
    isPlayer: boolean;
}

/** One wardrobe save slot, as returned by the 'player-wardrobe' page query. */
export interface WardrobeSlotInfo {
    index: number;
    name: string;
    /** Cropped data-URL; missing when the game hasn't drawn the slot yet */
    image?: string;
    /** Clothing/restraints in the slot's outfit */
    items?: import('./records').WornItem[];
}

export type ToPageMessage =
    | { kind: 'query'; id: string; query: PageQuery }
    | { kind: 'data-response'; id: string; result: unknown };

// ---------------------------------------------------------------------------
// window.postMessage envelopes
// ---------------------------------------------------------------------------

export interface PageEnvelope {
    source: typeof PAGE_SOURCE;
    message: PageMessage;
}

export interface RelayEnvelope {
    source: typeof RELAY_SOURCE;
    message: ToPageMessage;
}

export function isPageEnvelope(data: unknown): data is PageEnvelope {
    return typeof data === 'object' && data !== null && (data as PageEnvelope).source === PAGE_SOURCE;
}

export function isRelayEnvelope(data: unknown): data is RelayEnvelope {
    return typeof data === 'object' && data !== null && (data as RelayEnvelope).source === RELAY_SOURCE;
}

// ---------------------------------------------------------------------------
// UI ⇄ background API (chrome.runtime.sendMessage)
// ---------------------------------------------------------------------------

/** One online friend, as reported by the server's OnlineFriends query. */
export interface OnlineFriendInfo {
    type: 'Friend' | 'Submissive' | 'Lover';
    memberNumber: number;
    name: string;
    chatRoomName?: string | null;
    chatRoomSpace?: string | null;
    chatRoomMemberCount?: number;
    chatRoomLimit?: number;
    private?: boolean;
}

/** Live game-tab status the background tracks per tab. */
export interface TabStatus {
    tabId: number;
    memberNumber?: number;
    characterName?: string;
    sessionId?: string;
    channelId?: number;
    roomName?: string;
    modLoaded: boolean;
    /** The tab is running an injected script from an older extension build */
    needsRefresh?: boolean;
    /** This character's online friends (from the latest OnlineFriends poll) */
    friends?: OnlineFriendInfo[];
    /** When the friends list was last refreshed */
    friendsUpdated?: number;
    /** Capture paused for this tab specifically */
    capturePaused?: boolean;
    /** Current room is private and the skip-private-rooms rule is active */
    roomPrivate?: boolean;
}

export interface ApiEndpoints {
    ping: { params: undefined; result: { now: number; version: string } };
    'tabs.status': { params: undefined; result: TabStatus[] };
    'tabs.setPaused': { params: { tabId: number; paused: boolean }; result: null };
    /** Run a PageQuery against the live game tab of the given character. */
    'page.query': {
        params: { memberNumber: number; query: PageQuery };
        result: PageQueryResult;
    };
}

export type ApiEndpoint = keyof ApiEndpoints;

export interface ApiRequest<E extends ApiEndpoint = ApiEndpoint> {
    kind: 'bct-api';
    endpoint: E;
    params: ApiEndpoints[E]['params'];
}

export type ApiResponse<E extends ApiEndpoint = ApiEndpoint> =
    | { ok: true; data: ApiEndpoints[E]['result'] }
    | { ok: false; error: string };

export function isApiRequest(data: unknown): data is ApiRequest {
    return typeof data === 'object' && data !== null && (data as ApiRequest).kind === 'bct-api';
}
