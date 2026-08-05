/**
 * The Dexie database. The background service worker and the UI pages run on
 * the same extension origin, so they share this IndexedDB directly: the
 * background writes capture data, the UI reads it (no RPC layer needed).
 */
import Dexie, { type EntityTable } from 'dexie';
import type {
    ChatChannelRecord,
    ChatLogRecord,
    MemberRecord,
    MemberSeenRecord,
    PlayerSessionRecord,
} from './records';

export class BctDatabase extends Dexie {
    members!: EntityTable<MemberRecord, 'memberNumber'>;
    chat!: EntityTable<ChatLogRecord, 'id'>;
    chatChannels!: EntityTable<ChatChannelRecord, 'id'>;
    memberSeen!: EntityTable<MemberSeenRecord, 'id'>;
    playerSessions!: EntityTable<PlayerSessionRecord, 'id'>;

    constructor() {
        super('bc-toolbox');
        this.version(1).stores({
            members: 'memberNumber, isPlayer, name',
            chat: '++id, channelId, [channelId+created], sender',
            chatChannels: '++id, sessionId, [sessionId+left]',
            memberSeen: '++id, &[member+viewer], viewer',
            playerSessions: '++id, sessionId, member, [member+ended]',
        });
    }
}

export const db = new BctDatabase();
