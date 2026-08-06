/**
 * Handles live queries from the UI (routed background → relay → here):
 * lookups against game state that only exists in the page.
 */
import type { PageQuery, PageQueryResult, RosterMember, WardrobeSlotInfo } from '@/shared/protocol';
import { buildProfile, buildWornItems, canvasToDataUrl, cropCanvas, lockCodeOf } from './profile';

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
            } catch (error) {
                // One bad slot aborts the game's whole build loop, leaving
                // WardrobeCharacter truncated — item data below doesn't
                // depend on it, only previews do.
                console.warn('[BCT] wardrobe character build stopped early', error);
            }
            await renderWardrobeCanvases();

            // Player.Wardrobe is the authoritative slot list (including WCE
            // extended/local slots); dummy characters only supply previews.
            const bundleSlots = Player.Wardrobe ?? [];
            const count = Math.max(bundleSlots.length, WardrobeCharacter?.length ?? 0);
            const slots: WardrobeSlotInfo[] = [];
            for (let index = 0; index < count; index++) {
                const dummy = WardrobeCharacter?.[index];
                slots.push({
                    index,
                    name: Player.WardrobeCharacterNames?.[index] ?? `Slot ${index + 1}`,
                    // Preview images only within the limit (WCE's local
                    // wardrobe can reach 384 slots — imaging them all means
                    // seconds of jank and ~25MB payloads).
                    image:
                        index < WARDROBE_IMAGE_LIMIT && dummy?.Canvas
                            ? safeDataUrl(dummy.Canvas)
                            : undefined,
                    items: dummy
                        ? (buildWornItems(dummy) ?? [])
                        : bundlesToWornItems(bundleSlots[index]),
                });
            }
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

        case 'wardrobe-rename': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            const name = query.name.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 20);
            if (!name) {
                return { success: false, error: 'Name must be letters, numbers and spaces' };
            }
            if (query.slot >= 96) {
                return { success: false, error: 'WCE local slots (97+) have no server-side names' };
            }
            if (query.slot < 0 || query.slot >= (Player.WardrobeCharacterNames?.length ?? 0)) {
                return { success: false, error: 'No such wardrobe slot' };
            }
            // Set without the game's full-array push, then WCE-safe sync.
            WardrobeSetCharacterName(query.slot, name, false);
            syncWardrobe();
            return { success: true, data: null };
        }

        case 'wardrobe-clear': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            if (!Player.Wardrobe || query.slot < 0 || query.slot >= Player.Wardrobe.length) {
                return { success: false, error: 'No such wardrobe slot' };
            }
            // "Clear" = save the player's bare body into the slot (BC slots
            // are never empty — the game randomizes empty ones).
            Player.Wardrobe[query.slot] = Player.Appearance.filter(
                (a) => a.Asset.Group.Category === 'Appearance' && !a.Asset.Group.Clothing,
            ).map(WardrobeAssetBundle);
            syncWardrobe();
            const dummy = WardrobeCharacter?.[query.slot];
            if (dummy) {
                try {
                    dummy.Appearance = [];
                    WardrobeFastLoad(dummy, query.slot, false);
                } catch {
                    // Preview refresh is cosmetic — the next full load fixes it.
                }
            }
            return { success: true, data: null };
        }

        case 'wardrobe-swap': {
            if (!Player?.MemberNumber || !Player.Wardrobe) {
                return { success: false, error: 'Not logged in' };
            }
            const max = Player.Wardrobe.length;
            if (query.a < 0 || query.b < 0 || query.a >= max || query.b >= max || query.a === query.b) {
                return { success: false, error: 'Invalid slot pair' };
            }
            WardrobeSwapSlots(query.a, query.b);
            syncWardrobe();
            return { success: true, data: null };
        }

        case 'wardrobe-get-bundles': {
            if (!Player?.Wardrobe) {
                return { success: false, error: 'Not logged in' };
            }
            const bundles = Player.Wardrobe[query.slot];
            if (!bundles) {
                return { success: false, error: 'No such wardrobe slot' };
            }
            return { success: true, data: JSON.parse(JSON.stringify(bundles)) };
        }

        case 'wardrobe-all-bundles': {
            if (!Player?.Wardrobe) {
                return { success: false, error: 'Not logged in' };
            }
            const slots = Player.Wardrobe.map((bundles, index) => ({
                index,
                name: Player.WardrobeCharacterNames?.[index] ?? `Slot ${index + 1}`,
                bundles: bundles ?? [],
            }));
            return { success: true, data: JSON.parse(JSON.stringify({ slots })) };
        }

        case 'wardrobe-set-bundles': {
            if (!Player?.MemberNumber || !Player.Wardrobe) {
                return { success: false, error: 'Not logged in' };
            }
            if (query.slot < 0 || query.slot >= Player.Wardrobe.length) {
                return { success: false, error: 'No such wardrobe slot' };
            }
            // Keep only bundles for assets this game version actually has.
            const valid = (query.bundles as ItemBundle[]).filter(
                (b) =>
                    b &&
                    typeof b.Group === 'string' &&
                    typeof b.Name === 'string' &&
                    AssetGet('Female3DCG', b.Group, b.Name),
            );
            if (valid.length === 0) {
                return { success: false, error: 'No recognizable items in that outfit code' };
            }
            Player.Wardrobe[query.slot] = JSON.parse(JSON.stringify(valid)) as ItemBundle[];
            syncWardrobe();
            const target = WardrobeCharacter?.[query.slot];
            if (target) {
                try {
                    target.Appearance = [];
                    WardrobeFastLoad(target, query.slot, false);
                } catch {
                    // Preview refresh is cosmetic.
                }
            }
            return { success: true, data: { imported: valid.length, dropped: query.bundles.length - valid.length } };
        }

        case 'player-stats': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            return {
                success: true,
                data: {
                    money: Player.Money ?? 0,
                    skills: SkillValidSkills.map((type) => ({
                        type,
                        level: SkillGetLevelReal(Player, type),
                        progress: SkillGetProgress(Player, type),
                    })),
                    reputation: ReputationValidReputations.map((type) => ({
                        type,
                        value: ReputationGet(Player, type),
                    })),
                },
            };
        }

        case 'cheat-money': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            const amount = Math.floor(query.amount);
            if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
                return { success: false, error: 'Amount must be between 0 and 99,999,999' };
            }
            // The game's own money change (handles the server push itself).
            CharacterChangeMoney(Player, amount - (Player.Money ?? 0));
            ServerPlayerSync();
            return { success: true, data: { money: Player.Money } };
        }

        case 'cheat-skill': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            const skill = SkillValidSkills.find((s) => s === query.skill);
            if (!skill) {
                return { success: false, error: `Unknown skill "${query.skill}"` };
            }
            const level = Math.min(10, Math.max(0, Math.floor(query.level)));
            // SkillChange validates ranges and pushes to the server. Progress
            // restarts at 0 for the new level.
            SkillChange(Player, skill, level, 0, true);
            return { success: true, data: { level: SkillGetLevelReal(Player, skill) } };
        }

        case 'cheat-reputation': {
            if (!Player?.MemberNumber) {
                return { success: false, error: 'Not logged in' };
            }
            const rep = ReputationValidReputations.find((r) => r === query.rep);
            if (!rep) {
                return { success: false, error: `Unknown reputation "${query.rep}"` };
            }
            const value = Math.min(100, Math.max(-100, Math.floor(query.value)));
            // ReputationChange takes a delta and pushes to the server.
            ReputationChange(rep, value - ReputationGet(Player, rep), true);
            return { success: true, data: { value: ReputationGet(Player, rep) } };
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
 * Slots past this index (WCE local wardrobe territory) get item lists but no
 * preview images — see the wardrobe query above.
 */
const WARDROBE_IMAGE_LIMIT = 96;

/**
 * Push wardrobe + names to the server. Names sync only the server-backed
 * range (mirrors WCE); the hooked CharacterCompressWardrobe lets WCE split
 * extended/local slots.
 */
function syncWardrobe(): void {
    ServerAccountUpdate.QueueData({
        Wardrobe: CharacterCompressWardrobe(Player.Wardrobe ?? []),
        WardrobeCharacterNames: (Player.WardrobeCharacterNames ?? []).slice(0, 96),
    });
}

/**
 * Build a worn-items list straight from a wardrobe slot's server bundles,
 * for slots whose dummy character was never created.
 */
function bundlesToWornItems(bundles: (ItemBundle | null)[] | null | undefined): import('@/shared/records').WornItem[] {
    const items: import('@/shared/records').WornItem[] = [];
    for (const bundle of bundles ?? []) {
        if (!bundle?.Name || !bundle.Group) continue;
        const asset = AssetGet('Female3DCG', bundle.Group, bundle.Name);
        if (!asset) continue;
        const group = asset.Group;
        const restraint = group.Category === 'Item';
        if (!restraint && !group.Clothing) continue;
        const rawColor = Array.isArray(bundle.Color) ? bundle.Color[0] : bundle.Color;
        items.push({
            group: group.Name,
            groupLabel: group.Description,
            name: asset.Description,
            asset: asset.Name,
            color: rawColor && rawColor !== 'Default' ? rawColor : undefined,
            lock: bundle.Property?.LockedBy || undefined,
            lockCode: lockCodeOf(bundle.Property),
            craftName: bundle.Craft?.Name || undefined,
            craftedBy: bundle.Craft?.MemberNumber,
            restraint,
        });
    }
    return items;
}

/**
 * Wardrobe dummy characters are never drawn on screen (unless the in-game
 * wardrobe is open), and the game only rebuilds a character canvas during
 * on-screen drawing. Asset images finishing their download merely flag the
 * character `MustDraw` — so off-screen wardrobe canvases stay half-drawn
 * forever. Drive the rebuild ourselves: rebuild every flagged canvas, wait,
 * and repeat until no new flags appear (i.e. all images have arrived).
 * Only slots we'll actually image are rendered.
 */
async function renderWardrobeCanvases(): Promise<void> {
    let quietTicks = 0;
    for (let i = 0; i < 75 && quietTicks < 3; i++) {
        let redrew = false;
        for (const character of (WardrobeCharacter ?? []).slice(0, WARDROBE_IMAGE_LIMIT)) {
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
