/**
 * Turns captured page messages into database writes. All the "what does this
 * game event mean" logic lives here.
 */
import { db } from '@/shared/db';
import { parseBeepMessage } from '@/shared/beepMessage';
import { decodeDescription } from '@/shared/description';
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
    Ownership?: import('@/shared/records').OwnershipInfo | null;
    Lovership?: import('@/shared/records').LovershipInfo[];
    Reputation?: { Type: string; Value: number }[];
}

interface ChatRoomSyncData {
    Name?: string;
    Description?: string;
    Background?: string;
    Character?: RoomCharacterBundle[];
    Admin?: number[];
    Private?: boolean;
}

const STORED_MESSAGE_TYPES = new Set<string>(CHAT_TYPES);

// -- Privacy -----------------------------------------------------------------

interface PrivacySettings {
    capturePaused: boolean;
    skipPrivateRooms: boolean;
    /** Busy mode: capture runs as normal but no desktop notifications fire. */
    busyMode: boolean;
}

let privacy: PrivacySettings = { capturePaused: false, skipPrivateRooms: false, busyMode: false };
void chrome.storage.local.get('privacy').then((stored) => {
    privacy = { ...privacy, ...((stored.privacy as Partial<PrivacySettings>) ?? {}) };
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.privacy) {
        privacy = {
            capturePaused: false,
            skipPrivateRooms: false,
            busyMode: false,
            ...((changes.privacy.newValue as Partial<PrivacySettings>) ?? {}),
        };
    }
});

/** May we write anything captured from this tab to the database? */
function recording(state: TabState): boolean {
    return !privacy.capturePaused && !state.capturePaused;
}

/** May we write things captured from this tab's CURRENT ROOM? */
function recordingRoom(state: TabState): boolean {
    return recording(state) && !state.roomPrivate;
}

// -- Keyword alerts ----------------------------------------------------------

let alertKeywords: string[] = [];
void chrome.storage.local.get('alertKeywords').then((stored) => {
    alertKeywords = (stored.alertKeywords as string[]) ?? [];
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.alertKeywords) {
        alertKeywords = (changes.alertKeywords.newValue as string[]) ?? [];
    }
});

const KEYWORD_COOLDOWN = 60_000;
const keywordNotifiedAt = new Map<string, number>();

async function maybeKeywordAlert(state: TabState, line: ChatLinePayload, senderName?: string) {
    if (privacy.busyMode || alertKeywords.length === 0 || line.sender === state.memberNumber) {
        return;
    }
    const haystack = `${line.rendered ?? ''} ${line.content}`.toLowerCase();
    const hit = alertKeywords.find((kw) => kw && haystack.includes(kw.toLowerCase()));
    if (!hit) {
        return;
    }
    // No alert while the user is actively looking at that game tab.
    try {
        const tab = await chrome.tabs.get(state.tabId);
        if (tab.active) {
            const window = await chrome.windows.get(tab.windowId);
            if (window.focused) return;
        }
    } catch {
        // Tab lookup failed — alert anyway.
    }
    const now = Date.now();
    if (now - (keywordNotifiedAt.get(hit) ?? 0) < KEYWORD_COOLDOWN) {
        return;
    }
    keywordNotifiedAt.set(hit, now);
    const excerpt = (line.rendered ?? line.content).slice(0, 120);
    chrome.notifications.create(`bct-keyword:${state.memberNumber}:${state.channelId}`, {
        type: 'basic',
        iconUrl: 'bclub-logo.png',
        title: `"${hit}" mentioned${senderName ? ` by ${senderName}` : ''}`,
        message: excerpt,
    });
}

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
            if (recordingRoom(state)) {
                await upsertMember(profileToRecord(message.profile, message.timestamp));
            }
            return;

        case 'chat-line':
            if (recordingRoom(state)) {
                await onChatLine(state, message.line, message.timestamp);
            }
            return;

        case 'game-event':
            await onGameEvent(state, message.direction, message.event, message.data, message.timestamp);
            return;

        case 'query-result':
            state.pendingQueries.get(message.id)?.(message.result);
            return;

        case 'data-request': {
            const result = await handleDataRequest(state, message.request).catch(() => null);
            try {
                state.port?.postMessage({ kind: 'data-response', id: message.id, result });
            } catch {
                // Port died — the page's request just times out.
            }
            return;
        }
    }
}

async function handleDataRequest(
    state: TabState,
    request: import('@/shared/protocol').PageDataRequest,
): Promise<unknown> {
    if (request.type === 'member-overlay' && state.memberNumber) {
        const [record, note, seen] = await Promise.all([
            db.members.get(request.member),
            db.notes.where('[member+viewer]').equals([request.member, state.memberNumber]).first(),
            db.memberSeen
                .where('[member+viewer]')
                .equals([request.member, state.memberNumber])
                .first(),
        ]);
        const info: import('@/shared/protocol').OverlayMemberInfo = {
            met: !!seen || !!record,
            tags: note?.tags ?? [],
            note: note?.note ?? '',
            firstSeen: seen?.firstSeen,
            lastSeen: seen?.lastSeen,
            lastLocation: seen?.lastLocation,
            previousNames: (record?.nameHistory ?? [])
                .map((h) => h.nickname || h.name)
                .filter((n): n is string => !!n)
                .slice(-3),
        };
        return info;
    }
    return null;
}

/** Store a full profile pulled via an on-demand live page query. */
export async function storeCapturedProfile(profile: CapturedProfile): Promise<void> {
    await upsertMember(profileToRecord(profile, Date.now()));
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function onLogin(state: TabState, player: CapturedProfile): Promise<void> {
    const now = Date.now();
    if (recording(state)) {
        await upsertMember(profileToRecord(player, now));
    }

    if (state.memberNumber === player.memberNumber && state.sessionId) {
        return; // duplicate login event for a session we're already tracking
    }
    await onLogout(state); // close any previous character's session on this tab

    // An extension reload wipes tab state, orphaning the character's previous
    // session as forever-"active". One character can't be logged in twice, so
    // any open session of theirs is stale — close it (and its open rooms).
    // (Finalizing old data is fine even while paused.)
    await closeDanglingSessions(player.memberNumber, now);

    state.memberNumber = player.memberNumber;
    state.characterName = player.nickname || player.name;
    if (recording(state)) {
        state.sessionId = crypto.randomUUID();
        await db.playerSessions.add({
            sessionId: state.sessionId,
            member: player.memberNumber,
            started: now,
            ended: 0,
        });
    }
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
            case 'AccountBeep':
                return onBeep(state, 'in', data, timestamp);
        }
        return;
    }

    switch (event) {
        case 'ChatRoomLeave':
            return onRoomLeave(state, timestamp);
        case 'AccountBeep':
            return onBeep(state, 'out', data, timestamp);
    }
}

interface AccountBeepData {
    MemberNumber?: number;
    MemberName?: string;
    ChatRoomName?: string | null;
    BeepType?: string | null;
    Message?: unknown;
}

async function onBeep(
    state: TabState,
    direction: 'in' | 'out',
    data: unknown,
    timestamp: number,
): Promise<void> {
    const beep = data as AccountBeepData;
    if (!state.memberNumber || typeof beep?.MemberNumber !== 'number' || !recording(state)) {
        return;
    }
    // BeepType marks game/mod mechanics (leashes, addon sync) — not user beeps.
    if (beep.BeepType) {
        return;
    }
    let memberName = direction === 'in' ? beep.MemberName : undefined;
    if (!memberName) {
        const record = await db.members.get(beep.MemberNumber);
        memberName = record ? record.nickname || record.name : undefined;
    }
    const { text, meta } = parseBeepMessage(beep.Message);
    await db.beeps.add({
        viewer: state.memberNumber,
        member: beep.MemberNumber,
        memberName,
        direction,
        message: text,
        metadata: meta,
        roomName: direction === 'in' ? (beep.ChatRoomName ?? undefined) : undefined,
        created: timestamp,
    });
}

async function onRoomSync(state: TabState, data: ChatRoomSyncData, timestamp: number): Promise<void> {
    if (!data?.Name) {
        return;
    }

    // Privacy: paused tabs and (optionally) private rooms are display-only —
    // track where we are, close any open recording, write nothing else.
    state.roomPrivate = privacy.skipPrivateRooms && !!data.Private;
    if (!recordingRoom(state)) {
        if (state.channelId) {
            await db.chatChannels.update(state.channelId, { left: timestamp });
        }
        state.channelId = undefined;
        state.roomName = data.Name;
        await persistTab(state);
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
    if (!data?.Character || !recordingRoom(state)) {
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
    if (typeof data?.SourceMemberNumber === 'number' && recordingRoom(state)) {
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

/** Cooldown so a flaky connection doesn't re-notify about the same person. */
const NOTIFY_COOLDOWN = 30 * 60_000;
const lastNotified = new Map<string, number>();

async function onAccountQueryResult(state: TabState, data: unknown, timestamp: number): Promise<void> {
    const result = data as ServerFriendResult;
    if (result?.Query !== 'OnlineFriends' || !Array.isArray(result.Result)) {
        return;
    }
    const previous = state.friends;
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

    // Notify about Watch-tagged friends coming online. The first poll after
    // login sees everyone as "new" — skip it.
    if (privacy.busyMode || !previous || !state.memberNumber) {
        return;
    }
    const previouslyOnline = new Set(previous.map((f) => f.memberNumber));
    for (const friend of state.friends) {
        if (previouslyOnline.has(friend.memberNumber)) {
            continue;
        }
        const note = await db.notes
            .where('[member+viewer]')
            .equals([friend.memberNumber, state.memberNumber])
            .first();
        if (!note?.tags.some((tag) => tag.toLowerCase() === 'watch')) {
            continue;
        }
        const key = `${state.memberNumber}:${friend.memberNumber}`;
        if (timestamp - (lastNotified.get(key) ?? 0) < NOTIFY_COOLDOWN) {
            continue;
        }
        lastNotified.set(key, timestamp);
        chrome.notifications.create(`bct-friend:${state.memberNumber}:${friend.memberNumber}`, {
            type: 'basic',
            iconUrl: 'bclub-logo.png',
            title: `${friend.name} is online`,
            message: friend.private
                ? 'In a private room'
                : friend.chatRoomName
                  ? `In ${friend.chatRoomName}`
                  : 'Not in a room yet',
        });
    }
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
    // An incoming whisper is always addressed to us — the wire payload just
    // doesn't always say so.
    let target = line.target;
    if (
        line.type === 'Whisper' &&
        target === undefined &&
        state.memberNumber &&
        line.sender !== state.memberNumber
    ) {
        target = state.memberNumber;
    }
    await db.chat.add({
        channelId: state.channelId,
        type: line.type as ChatType,
        sender: line.sender,
        senderName,
        target,
        message: line.content,
        dictionary: line.dictionary,
        renderedText: line.rendered,
        created: timestamp,
    });
    await markSeen(state, line.sender, timestamp);
    await maybeKeywordAlert(state, line, senderName);
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
        description: decodeDescription(bundle.Description),
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
        // People rename constantly in BC — keep the old identity on record
        // instead of silently overwriting it.
        const nameChanged = !!defined.name && !!existing.name && defined.name !== existing.name;
        const nicknameChanged =
            defined.nickname !== undefined &&
            !!existing.nickname &&
            defined.nickname !== existing.nickname;
        if (nameChanged || nicknameChanged) {
            const history = existing.nameHistory ?? [];
            const last = history[history.length - 1];
            if (!last || last.name !== existing.name || last.nickname !== existing.nickname) {
                history.push({
                    name: existing.name || undefined,
                    nickname: existing.nickname,
                    changed: Date.now(),
                });
                defined.nameHistory = history.slice(-20);
            }
        }

        // Same idea for ownership/lovership: when a capture reports a state
        // that differs from the last KNOWN state, keep the old one with a date.
        const ownershipChanged =
            'ownership' in defined &&
            existing.ownership !== undefined &&
            ownershipKey(defined.ownership) !== ownershipKey(existing.ownership);
        const lovershipChanged =
            defined.lovership !== undefined &&
            existing.lovership !== undefined &&
            lovershipKey(defined.lovership) !== lovershipKey(existing.lovership);
        if (ownershipChanged || lovershipChanged) {
            const history = existing.relationshipHistory ?? [];
            history.push({
                ...(ownershipChanged ? { ownership: existing.ownership } : {}),
                ...(lovershipChanged ? { lovership: existing.lovership } : {}),
                changed: Date.now(),
            });
            defined.relationshipHistory = history.slice(-20);
        }

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

function ownershipKey(ownership: import('@/shared/records').OwnershipInfo | null | undefined): string {
    return ownership?.MemberNumber !== undefined
        ? `${ownership.MemberNumber}:${ownership.Stage ?? 0}`
        : 'none';
}

function lovershipKey(lovership: import('@/shared/records').LovershipInfo[] | undefined): string {
    return (lovership ?? [])
        .filter((l) => l.MemberNumber !== undefined || l.Name)
        .map((l) => `${l.MemberNumber ?? l.Name}:${l.Stage ?? 0}`)
        .sort()
        .join('|');
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
