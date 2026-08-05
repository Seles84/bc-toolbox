/**
 * Handles live queries from the UI (routed background → relay → here):
 * lookups against game state that only exists in the page.
 */
import type { PageQuery, PageQueryResult, WardrobeSlotInfo } from '@/shared/protocol';
import { buildProfile, cropCanvas } from './profile';

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
            }));
            return { success: true, data: { slots } };
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
        return cropCanvas(canvas)?.toDataURL('image/png');
    } catch {
        return undefined;
    }
}
