/**
 * Turns captured page messages into database writes. All the "what does this
 * game event mean" logic lives here.
 */
import { db } from '@/shared/db';
import { CHAT_TYPES, type ChatType, type MemberRecord } from '@/shared/records';
import type { CapturedProfile, ChatLinePayload, PageMessage } from '@/shared/protocol';
import { persistTab, type TabState } from './state';

/** Shape of the character bundles inside ChatRoomSync payloads. */
interface RoomCharacterBundle {
    MemberNumber?: number;
    Name?: string;
    Nickname?: string;
    Title?: string;
    Description?: string;
    Creation?: number;
    LabelColor?: string;
    Ownership?: import('@/shared/records').OwnershipInfo;
    Lovership?: import('@/shared/records').LovershipInfo[];
    Reputation?: { Type: string; Value: number }[];
}

interface ChatRoomSyncData {
    Name?: string;
    Description?: string;
    Background?: string;
    Character?: RoomCharacterBundle[];
    Admin?: number[];
}

const STORED_MESSAGE_TYPES = new Set<string>(CHAT_TYPES);

export async function handlePageMessage(state: TabState, message: PageMessage): Promise<void> {
    switch (message.kind) {
        case 'mod-loaded':
            state.modLoaded = true;
            // An older injected script (or an explicit stale marker) means the
            // page speaks an outdated protocol until the tab is refreshed.
            state.needsRefresh = Boolean(message.stale) || message.build !== __BCT_BUILD__;
            if (state.needsRefresh) {
                console.warn(`[BCT] tab ${state.tabId} runs an outdated injected script — needs refresh`);
            }
            return;

        case 'session':
            if (message.state === 'login') {
                await onLogin(state, message.player);
            } else {
                await onLogout(state);
            }
            return;

        case 'appearance':
            await upsertMember(profileToRecord(message.profile, message.timestamp));
            return;

        case 'chat-line':
            await onChatLine(state, message.line, message.timestamp);
            return;

        case 'game-event':
            await onGameEvent(state, message.direction, message.event, message.data, message.timestamp);
            return;

        case 'query-result':
            state.pendingQueries.get(message.id)?.(message.result);
            return;
    }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function onLogin(state: TabState, player: CapturedProfile): Promise<void> {
    const now = Date.now();
    await upsertMember(profileToRecord(player, now));

    if (state.memberNumber === player.memberNumber && state.sessionId) {
        return; // duplicate login event for a session we're already tracking
    }
    await onLogout(state); // close any previous character's session on this tab

    // An extension reload wipes tab state, orphaning the character's previous
    // session as forever-"active". One character can't be logged in twice, so
    // any open session of theirs is stale — close it (and its open rooms).
    await closeDanglingSessions(player.memberNumber, now);

    state.memberNumber = player.memberNumber;
    state.characterName = player.nickname || player.name;
    state.sessionId = crypto.randomUUID();
    await db.playerSessions.add({
        sessionId: state.sessionId,
        member: player.memberNumber,
        started: now,
        ended: 0,
    });
    await persistTab(state);
}

async function closeDanglingSessions(member: number, timestamp: number): Promise<void> {
    const open = await db.playerSessions.where('[member+ended]').equals([member, 0]).toArray();
    for (const session of open) {
        await db.chatChannels
            .where('sessionId')
            .equals(session.sessionId)
            .and((channel) => channel.left === 0)
            .modify({ left: timestamp });
        if (session.id !== undefined) {
            await db.playerSessions.update(session.id, { ended: timestamp });
        }
    }
}

async function onLogout(state: TabState): Promise<void> {
    const now = Date.now();
    if (state.channelId) {
        await db.chatChannels.update(state.channelId, { left: now });
    }
    if (state.sessionId) {
        await db.playerSessions.where('sessionId').equals(state.sessionId).modify({ ended: now });
    }
    state.memberNumber = undefined;
    state.characterName = undefined;
    state.sessionId = undefined;
    state.channelId = undefined;
    state.roomName = undefined;
    await persistTab(state);
}

// ---------------------------------------------------------------------------
// Game events
// ---------------------------------------------------------------------------

async function onGameEvent(
    state: TabState,
    direction: 'server' | 'client',
    event: string,
    data: unknown,
    timestamp: number,
): Promise<void> {
    if (direction === 'server') {
        switch (event) {
            case 'ChatRoomSync':
                return onRoomSync(state, data as ChatRoomSyncData, timestamp);
            case 'ChatRoomSyncMemberJoin':
                return onMemberJoin(state, data as { Character?: RoomCharacterBundle }, timestamp);
            case 'ChatRoomSyncMemberLeave':
                return onMemberLeave(state, data as { SourceMemberNumber?: number }, timestamp);
            case 'AccountQueryResult':
                return onAccountQueryResult(state, data, timestamp);
        }
        return;
    }

    switch (event) {
        case 'ChatRoomLeave':
            return onRoomLeave(state, timestamp);
    }
}

async function onRoomSync(state: TabState, data: ChatRoomSyncData, timestamp: number): Promise<void> {
    if (!data?.Name) {
        return;
    }

    // A worker restart can drop the session; recover so capture keeps working.
    if (!state.sessionId) {
        state.sessionId = crypto.randomUUID();
        if (state.memberNumber) {
            await closeDanglingSessions(state.memberNumber, timestamp);
            await db.playerSessions.add({
                sessionId: state.sessionId,
                member: state.memberNumber,
                started: timestamp,
                ended: 0,
            });
        }
    }

    const memberNumbers = (data.Character ?? [])
        .map((c) => c.MemberNumber)
        .filter((n): n is number => typeof n === 'number');

    if (state.channelId && state.roomName === data.Name) {
        // Same room re-syncing (membership change, admin edit, …)
        const channel = await db.chatChannels.get(state.channelId);
        const merged = [...new Set([...(channel?.memberNumbers ?? []), ...memberNumbers])];
        await db.chatChannels.update(state.channelId, {
            description: data.Description,
            background: data.Background,
            memberNumbers: merged,
        });
    } else {
        if (state.channelId) {
            await db.chatChannels.update(state.channelId, { left: timestamp });
        }
        state.channelId = await db.chatChannels.add({
            sessionId: state.sessionId,
            roomName: data.Name,
            description: data.Description,
            background: data.Background,
            memberNumbers,
            entered: timestamp,
            left: 0,
        });
        state.roomName = data.Name;
        await persistTab(state);
    }

    for (const bundle of data.Character ?? []) {
        await captureRoomCharacter(state, bundle, timestamp);
    }
}

async function onMemberJoin(
    state: TabState,
    data: { Character?: RoomCharacterBundle },
    timestamp: number,
): Promise<void> {
    if (!data?.Character) {
        return;
    }
    await captureRoomCharacter(state, data.Character, timestamp);
    if (state.channelId && typeof data.Character.MemberNumber === 'number') {
        const channel = await db.chatChannels.get(state.channelId);
        if (channel && !channel.memberNumbers?.includes(data.Character.MemberNumber)) {
            await db.chatChannels.update(state.channelId, {
                memberNumbers: [...(channel.memberNumbers ?? []), data.Character.MemberNumber],
            });
        }
    }
}

async function onMemberLeave(
    state: TabState,
    data: { SourceMemberNumber?: number },
    timestamp: number,
): Promise<void> {
    if (typeof data?.SourceMemberNumber === 'number') {
        await markSeen(state, data.SourceMemberNumber, timestamp);
    }
}

interface ServerFriendResult {
    Query?: string;
    Result?: {
        Type?: 'Friend' | 'Submissive' | 'Lover';
        MemberNumber?: number;
        MemberName?: string;
        ChatRoomName?: string | null;
        ChatRoomSpace?: string | null;
        ChatRoomMemberCount?: number;
        ChatRoomLimit?: number;
        Private?: boolean;
    }[];
}

function onAccountQueryResult(state: TabState, data: unknown, timestamp: number): void {
    const result = data as ServerFriendResult;
    if (result?.Query !== 'OnlineFriends' || !Array.isArray(result.Result)) {
        return;
    }
    state.friends = result.Result.filter((f) => typeof f.MemberNumber === 'number').map((f) => ({
        type: f.Type ?? 'Friend',
        memberNumber: f.MemberNumber!,
        name: f.MemberName ?? `#${f.MemberNumber}`,
        chatRoomName: f.ChatRoomName,
        chatRoomSpace: f.ChatRoomSpace,
        chatRoomMemberCount: f.ChatRoomMemberCount,
        chatRoomLimit: f.ChatRoomLimit,
        private: f.Private,
    }));
    state.friendsUpdated = timestamp;
}

async function onChatLine(state: TabState, line: ChatLinePayload, timestamp: number): Promise<void> {
    if (!state.channelId || !STORED_MESSAGE_TYPES.has(line.type)) {
        return; // Hidden/Status/etc. — game-internal traffic
    }
    let senderName = line.senderName;
    if (!senderName) {
        const sender = await db.members.get(line.sender);
        senderName = sender ? sender.nickname || sender.name : undefined;
    }
    await db.chat.add({
        channelId: state.channelId,
        type: line.type as ChatType,
        sender: line.sender,
        senderName,
        target: line.target,
        message: line.content,
        dictionary: line.dictionary,
        renderedText: line.rendered,
        created: timestamp,
    });
    await markSeen(state, line.sender, timestamp);
}

async function onRoomLeave(state: TabState, timestamp: number): Promise<void> {
    if (state.channelId) {
        await db.chatChannels.update(state.channelId, { left: timestamp });
    }
    state.channelId = undefined;
    state.roomName = undefined;
    await persistTab(state);
}

// ---------------------------------------------------------------------------
// Member bookkeeping
// ---------------------------------------------------------------------------

function profileToRecord(profile: CapturedProfile, timestamp: number): Partial<MemberRecord> & { memberNumber: number } {
    const { isPlayer, ...rest } = profile;
    return {
        ...rest,
        isPlayer: isPlayer ? 1 : 0,
        capturedAt: timestamp,
    };
}

async function captureRoomCharacter(
    state: TabState,
    bundle: RoomCharacterBundle,
    timestamp: number,
): Promise<void> {
    if (typeof bundle.MemberNumber !== 'number' || bundle.MemberNumber <= 0) {
        return;
    }
    await upsertMember({
        memberNumber: bundle.MemberNumber,
        name: bundle.Name,
        nickname: bundle.Nickname,
        title: bundle.Title,
        description: bundle.Description,
        creation: bundle.Creation,
        labelColor: bundle.LabelColor,
        ownership: bundle.Ownership,
        lovership: bundle.Lovership,
        reputation: bundle.Reputation,
        capturedAt: timestamp,
    });
    await markSeen(state, bundle.MemberNumber, timestamp);
}

/** Merge-upsert: never clobber existing richer data with undefined fields. */
async function upsertMember(record: Partial<MemberRecord> & { memberNumber: number }): Promise<void> {
    const defined = Object.fromEntries(
        Object.entries(record).filter(([, value]) => value !== undefined),
    ) as Partial<MemberRecord> & { memberNumber: number };

    const existing = await db.members.get(defined.memberNumber);
    if (existing) {
        await db.members.update(defined.memberNumber, defined);
    } else {
        await db.members.put({
            name: '',
            isPlayer: 0,
            capturedAt: Date.now(),
            ...defined,
        } as MemberRecord);
    }
}

async function markSeen(state: TabState, member: number, timestamp: number): Promise<void> {
    if (!state.memberNumber || member === state.memberNumber) {
        return;
    }
    const existing = await db.memberSeen.where('[member+viewer]').equals([member, state.memberNumber]).first();
    if (existing?.id) {
        await db.memberSeen.update(existing.id, {
            lastSeen: timestamp,
            lastLocation: state.roomName ?? existing.lastLocation,
        });
    } else {
        await db.memberSeen.add({
            member,
            viewer: state.memberNumber,
            firstSeen: timestamp,
            lastSeen: timestamp,
            lastLocation: state.roomName,
        });
    }
}
