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

/** One worn clothing item or restraint, captured from a character's appearance. */
export interface WornItem {
    /** Slot group name, e.g. "ItemArms" */
    group: string;
    /** Human slot label, e.g. "Arms" */
    groupLabel: string;
    /** Human item name as the game displays it, e.g. "Steel Cuffs" */
    name: string;
    /** Technical asset name */
    asset: string;
    color?: string;
    /** Lock asset name when locked, e.g. "ExclusivePadlock" */
    lock?: string;
    /** The lock's password/combination when one is set (shown only with cheats on) */
    lockCode?: string;
    craftName?: string;
    craftedBy?: number;
    restraint: boolean;
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
    /** null = known to be unowned; undefined = never reported */
    ownership?: OwnershipInfo | null;
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
    /** Clothing + restraints worn at last capture (body slots excluded) */
    wornItems?: WornItem[];
    /** Detected addons (LSCG/FBC/etc.) as raw blobs */
    addons?: Record<string, unknown>;
    /** Previous names/nicknames, appended whenever a capture changes them */
    nameHistory?: { name?: string; nickname?: string; changed: number }[];
    /** Previous ownership/lovership states, appended whenever a capture changes them */
    relationshipHistory?: {
        ownership?: OwnershipInfo | null;
        lovership?: LovershipInfo[];
        changed: number;
    }[];
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

/** One beep sent or received by one of the player's characters — `beeps` table. */
export interface BeepRecord {
    id?: number;
    /** The logged-in character on our side */
    viewer: number;
    /** The other party */
    member: number;
    memberName?: string;
    direction: 'in' | 'out';
    /** Attached message text, when the beep carried one */
    message?: string;
    /** Addon metadata parsed off the message (FBC/WCE messageType, color…) */
    metadata?: Record<string, unknown>;
    /** Where the other party was when they beeped us (incoming only) */
    roomName?: string;
    created: number;
}

/** Personal note + tags about a member, per observing character — `notes` table. */
export interface MemberNoteRecord {
    id?: number;
    member: number;
    /** The character whose note this is */
    viewer: number;
    note: string;
    tags: string[];
    updated: number;
}

/** A starred chat line, per viewing character — `bookmarks` table. */
export interface BookmarkRecord {
    id?: number;
    viewer: number;
    /** The bookmarked chat line's id */
    chatId: number;
    created: number;
}

/** One wardrobe slot inside a snapshot. */
export interface WardrobeSlotSnapshot {
    index: number;
    name: string;
    /** Cropped WebP data-URL preview */
    image?: string;
    items: WornItem[];
}

/** A saved point-in-time copy of a character's wardrobe — `wardrobeSnapshots` table. */
export interface WardrobeSnapshotRecord {
    id?: number;
    /** The character whose wardrobe this is */
    member: number;
    taken: number;
    slots: WardrobeSlotSnapshot[];
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
