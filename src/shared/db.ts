/**
 * The Dexie database. The background service worker and the UI pages run on
 * the same extension origin, so they share this IndexedDB directly: the
 * background writes capture data, the UI reads it (no RPC layer needed).
 */
import Dexie, { type EntityTable } from 'dexie';
import type {
    BeepRecord,
    BookmarkRecord,
    ChatChannelRecord,
    ChatLogRecord,
    MemberNoteRecord,
    MemberRecord,
    MemberSeenRecord,
    PlayerSessionRecord,
    WardrobeSnapshotRecord,
} from './records';

export class BctDatabase extends Dexie {
    members!: EntityTable<MemberRecord, 'memberNumber'>;
    chat!: EntityTable<ChatLogRecord, 'id'>;
    chatChannels!: EntityTable<ChatChannelRecord, 'id'>;
    memberSeen!: EntityTable<MemberSeenRecord, 'id'>;
    playerSessions!: EntityTable<PlayerSessionRecord, 'id'>;
    beeps!: EntityTable<BeepRecord, 'id'>;
    notes!: EntityTable<MemberNoteRecord, 'id'>;
    bookmarks!: EntityTable<BookmarkRecord, 'id'>;
    wardrobeSnapshots!: EntityTable<WardrobeSnapshotRecord, 'id'>;

    constructor() {
        super('bc-toolbox');
        this.version(1).stores({
            members: 'memberNumber, isPlayer, name',
            chat: '++id, channelId, [channelId+created], sender',
            chatChannels: '++id, sessionId, [sessionId+left]',
            memberSeen: '++id, &[member+viewer], viewer',
            playerSessions: '++id, sessionId, member, [member+ended]',
        });
        this.version(2).stores({
            beeps: '++id, viewer, [viewer+member], created',
        });
        this.version(3).stores({
            notes: '++id, &[member+viewer], viewer',
        });
        this.version(4).stores({
            bookmarks: '++id, &[viewer+chatId], viewer',
        });
        this.version(5).stores({
            wardrobeSnapshots: '++id, member, taken',
        });
    }
}

export const db = new BctDatabase();
