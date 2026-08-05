/**
 * Database record shapes. The Dexie schema lives in `db.ts`; these types are
 * shared by the capture pipeline (writers) and the UI (readers).
 */

export const CHAT_TYPES = ['Chat', 'Emote', 'Activity', 'Whisper', 'Action', 'ServerMessage'] as const;
export type ChatType = (typeof CHAT_TYPES)[number];

/** Ownership as the game reports it (Stage 0 = on trial, 1 = collared). */
export interface OwnershipInfo {
    Name?: string;
    MemberNumber?: number;
    Stage?: number;
    Start?: number;
}

/** Lovership as the game reports it (Stage 0 = dating, 1 = engaged, 2 = married). */
export interface LovershipInfo {
    Name?: string;
    MemberNumber?: number;
    Stage?: number;
    Start?: number;
}

/** Captured character profile — the `members` table. Keyed by member number. */
export interface MemberRecord {
    memberNumber: number;
    name: string;
    nickname?: string;
    accountName?: string;
    /** 1/0 rather than boolean so it can be indexed by IndexedDB */
    isPlayer: 0 | 1;
    title?: string;
    description?: string;
    creation?: number;
    labelColor?: string;
    pronouns?: string;
    money?: number;
    difficulty?: number;
    itemPermission?: number;
    ownership?: OwnershipInfo;
    lovership?: LovershipInfo[];
    submissives?: number[];
    friends?: Record<string, string>;
    whitelist?: number[];
    blacklist?: number[];
    reputation?: { Type: string; Value: number }[];
    skills?: { Type: string; Level: number; Progress: number; ModifierLevel?: number }[];
    crafting?: unknown[];
    /** "Group/AssetName" keys the member marked as favourite */
    favoriteItems?: string[];
    /** Cropped PNG data-URL of the character canvas */
    appearanceImage?: string;
    /** Detected addons (LSCG/FBC/etc.) as raw blobs */
    addons?: Record<string, unknown>;
    /** Last time any of the above was refreshed */
    capturedAt: number;
}

/** One visit to a chat room — the `chatChannels` table. */
export interface ChatChannelRecord {
    id?: number;
    /** Play-session UUID this visit belongs to (see PlayerSessionRecord) */
    sessionId: string;
    roomName: string;
    description?: string;
    background?: string;
    creator?: number;
    /** Member numbers seen in the room at any point during the visit */
    memberNumbers?: number[];
    entered: number;
    /** 0 while the room is still open */
    left: number;
}

/** One chat line — the `chat` table. */
export interface ChatLogRecord {
    id?: number;
    channelId: number;
    type: ChatType;
    sender: number;
    senderName?: string;
    /** Whisper target, when applicable */
    target?: number;
    message: string;
    /** The game's raw Dictionary payload for templated Action/Activity lines */
    dictionary?: unknown[];
    /**
     * The line exactly as the game rendered it for the player — templating,
     * pronouns, translations and other mods' changes already applied.
     */
    renderedText?: string;
    created: number;
}

/** First/last sighting of a member, per observing character — `memberSeen` table. */
export interface MemberSeenRecord {
    id?: number;
    member: number;
    /** The logged-in character who saw them */
    viewer: number;
    firstSeen: number;
    lastSeen: number;
    lastLocation?: string;
}

/** One login session of one of the player's characters — `playerSessions` table. */
export interface PlayerSessionRecord {
    id?: number;
    sessionId: string;
    member: number;
    started: number;
    /** 0 while the session is still open */
    ended: number;
}
