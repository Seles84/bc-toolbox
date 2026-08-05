/**
 * Handles live queries from the UI (routed background → relay → here):
 * lookups against game state that only exists in the page.
 */
import type { PageQuery, PageQueryResult, RosterMember, WardrobeSlotInfo } from '@/shared/protocol';
import { buildProfile, buildWornItems, canvasToDataUrl, cropCanvas } from './profile';

export async function runQuery(query: PageQuery): Promise<PageQueryResult> {
    switch (query.type) {
        case 'character-data': {
            const target = ChatRoomCharacter?.find((c) => c.MemberNumber === query.memberNumber);
            if (!target) {
                return { success: false, error: `Character ${query.memberNumber} is not in the room` };
            }
            const profile = buildProfile(target, true);
            return profile
                ? { success: true, data: profile }
                : { success: false, error: `Could not build profile for ${query.memberNumber}` };
        }

        case 'player-data': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            return {
                success: true,
                data: {
                    wardrobeNames: Player.WardrobeCharacterNames,
                    crafting: Player.Crafting,
                    savedColors: Player.SavedColors,
                },
            };
        }

        case 'player-wardrobe': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            if (!Player.Wardrobe || Player.Wardrobe.length === 0) {
                return { success: false, error: 'Wardrobe not loaded yet' };
            }
            try {
                WardrobeLoadCharacters(false);
            } catch {
                // Wardrobe may not be initialised yet; fall through with whatever exists.
            }
            await renderWardrobeCanvases();

            const slots: WardrobeSlotInfo[] = (WardrobeCharacter ?? []).map((c, index) => ({
                index,
                name: Player.WardrobeCharacterNames?.[index] ?? `Slot ${index + 1}`,
                image: c?.Canvas ? safeDataUrl(c.Canvas) : undefined,
                items: c ? (buildWornItems(c) ?? []) : [],
            }));
            return { success: true, data: { slots } };
        }

        case 'room-roster': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            if (!ChatRoomData || !ChatRoomCharacter?.length) {
                return { success: false, error: 'Not in a chat room' };
            }
            const members: RosterMember[] = ChatRoomCharacter.filter(
                (c) => typeof c.MemberNumber === 'number',
            ).map((c) => ({
                memberNumber: c.MemberNumber!,
                name: c.Name,
                nickname: c.Nickname,
                labelColor: c.LabelColor,
                isPlayer: c.IsPlayer(),
            }));
            return { success: true, data: { members } };
        }

        case 'send-whisper': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            if (CurrentScreen !== 'ChatRoom') {
                return { success: false, error: 'Your character is not in a chat room' };
            }
            if (!ChatRoomCharacter?.some((c) => c.MemberNumber === query.target)) {
                return { success: false, error: 'They are not in your room' };
            }
            // The game's own send path: garbling, range checks and the local
            // echo (which our chat capture stores) all apply as normal.
            const result = ChatRoomSendWhisper(query.target, query.message);
            if (result === 'target-gone') {
                return { success: false, error: 'They just left the room' };
            }
            if (result === 'target-out-of-range') {
                return { success: false, error: 'They are out of whisper range' };
            }
            return { success: true, data: null };
        }

        case 'send-beep': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            // Same shape as the WCE instant messenger's sends.
            ServerSend('AccountBeep', {
                MemberNumber: query.target,
                BeepType: '',
                IsSecret: true,
                Message: query.message,
            });
            return { success: true, data: null };
        }
    }
}

/**
 * Wardrobe dummy characters are never drawn on screen (unless the in-game
 * wardrobe is open), and the game only rebuilds a character canvas during
 * on-screen drawing. Asset images finishing their download merely flag the
 * character `MustDraw` — so off-screen wardrobe canvases stay half-drawn
 * forever. Drive the rebuild ourselves: rebuild every flagged canvas, wait,
 * and repeat until no new flags appear (i.e. all images have arrived).
 */
async function renderWardrobeCanvases(): Promise<void> {
    let quietTicks = 0;
    for (let i = 0; i < 50 && quietTicks < 3; i++) {
        let redrew = false;
        for (const character of WardrobeCharacter ?? []) {
            if (character?.MustDraw) {
                try {
                    CharacterLoadCanvas(character);
                    redrew = true;
                } catch {
                    // A broken outfit shouldn't stall the rest of the wardrobe.
                }
            }
        }
        quietTicks = redrew ? 0 : quietTicks + 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

function safeDataUrl(canvas: HTMLCanvasElement): string | undefined {
    try {
        return canvasToDataUrl(cropCanvas(canvas));
    } catch {
        return undefined;
    }
}
