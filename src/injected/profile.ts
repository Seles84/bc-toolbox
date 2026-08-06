/**
 * Builds a CapturedProfile from a live game Character, including a cropped
 * PNG of its appearance canvas when one has been drawn.
 */
import type { CapturedProfile } from '@/shared/protocol';
import type { WornItem } from '@/shared/records';
import { decodeDescription } from '@/shared/description';

export function buildProfile(character: Character, withAppearance: boolean): CapturedProfile | null {
    if (!character.MemberNumber || character.MemberNumber <= 0) {
        return null;
    }

    let friends: Record<string, string> | undefined;
    if (character.IsPlayer() && Player.FriendNames) {
        try {
            friends = Object.fromEntries(Player.FriendNames);
        } catch {
            friends = undefined;
        }
    }

    const profile: CapturedProfile = {
        memberNumber: character.MemberNumber,
        name: character.Name,
        nickname: character.Nickname,
        accountName: character.IsPlayer() ? character.AccountName : undefined,
        isPlayer: character.IsPlayer(),
        title: character.Title,
        description: decodeDescription(character.Description),
        creation: character.Creation,
        labelColor: character.LabelColor,
        pronouns: character.GetPronouns(),
        money: character.IsPlayer() ? character.Money : undefined,
        difficulty: character.GetDifficulty(),
        // R117+ renamed the old numeric ItemPermission to AllowedInteractions
        itemPermission: character.AllowedInteractions,
        // null (not undefined) when the character is verifiably unowned, so
        // the background can record a release in the relationship history.
        ownership: character.Ownership ? sanitize(character.Ownership) : null,
        lovership: sanitize(character.Lovership),
        submissives: character.IsPlayer() ? [...(Player.SubmissivesList ?? [])] : undefined,
        friends,
        whitelist: character.WhiteList,
        blacklist: character.BlackList,
        ghostlist: character.IsPlayer() ? [...(Player.GhostList ?? [])] : undefined,
        reputation: sanitize(character.Reputation) as CapturedProfile['reputation'],
        skills: sanitize(character.Skill) as CapturedProfile['skills'],
        crafting: buildCrafting(character),
        // Favorites are folded into per-item PermissionItems records since R117
        favoriteItems: Object.entries(character.PermissionItems ?? {})
            .filter(([, permission]) => permission?.Permission === 'Favorite')
            .map(([key]) => key),
        addons: collectAddons(character),
        wornItems: buildWornItems(character),
    };

    if (withAppearance && character.Canvas) {
        try {
            // cropCanvas returns null for a blank canvas (not drawn yet) —
            // better to send no image than overwrite a good one with a blank.
            profile.appearanceImage = canvasToDataUrl(cropCanvas(character.Canvas));
        } catch {
            // Canvas may be tainted or not yet drawn; profile is still useful.
        }
    }

    return profile;
}

/** WebP is ~3-4× smaller than PNG for character art; fall back if unsupported. */
export function canvasToDataUrl(canvas: HTMLCanvasElement | null): string | undefined {
    if (!canvas) {
        return undefined;
    }
    const webp = canvas.toDataURL('image/webp', 0.85);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

/**
 * Clothing and restraints currently worn. Item names come from the game's own
 * loaded asset descriptions, so they're human-readable and localized. Body
 * slots (hair, eyes…) and script items are skipped.
 */
export function buildWornItems(character: Character): WornItem[] | undefined {
    try {
        const items: WornItem[] = [];
        for (const item of character.Appearance ?? []) {
            const group = item.Asset.Group;
            const restraint = group.Category === 'Item';
            if (!restraint && !group.Clothing) {
                continue;
            }
            const rawColor = Array.isArray(item.Color) ? item.Color[0] : item.Color;
            items.push({
                group: group.Name,
                groupLabel: group.Description,
                name: item.Asset.Description,
                asset: item.Asset.Name,
                color: rawColor && rawColor !== 'Default' ? rawColor : undefined,
                lock: item.Property?.LockedBy || undefined,
                lockCode: lockCodeOf(item.Property),
                craftName: item.Craft?.Name || undefined,
                craftedBy: item.Craft?.MemberNumber,
                restraint,
            });
        }
        return items.length > 0 ? items : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Password/combination of a locked item, when the lock carries one. The game
 * syncs these to every client and merely hides them in its UI.
 */
export function lockCodeOf(property: ItemProperties | undefined): string | undefined {
    if (!property?.LockedBy) {
        return undefined;
    }
    const code = property.Password ?? property.CombinationNumber;
    return code !== undefined && code !== '' ? String(code) : undefined;
}

/**
 * Crafting arrives parsed for the player but as a compressed string for other
 * characters — the game's own deserializer handles both shapes.
 */
function buildCrafting(character: Character): unknown[] | undefined {
    try {
        const source = character.IsPlayer()
            ? Player.Crafting
            : (character as Character & { Crafting?: string | (null | CraftingItem)[] }).Crafting;
        if (!source) {
            return undefined;
        }
        const items = CraftingDecompressServerData(source).filter(Boolean);
        return items.length > 0 ? (sanitize(items) as unknown[] | undefined) : undefined;
    } catch {
        return undefined;
    }
}

/** Addon payloads other mods stash on the character object. */
function collectAddons(character: Character): Record<string, unknown> | undefined {
    const c = character as Character & Record<string, unknown>;
    const addons: Record<string, unknown> = {};
    for (const key of ['LSCG', 'FBC', 'FBCOtherAddons', 'BCX', 'MPA'] as const) {
        if (c[key] !== undefined) {
            addons[key] = sanitize(c[key]);
        }
    }
    return Object.keys(addons).length > 0 ? addons : undefined;
}

/** Deep-clone through JSON so no functions/cycles ever hit postMessage. */
function sanitize<T>(value: T): T | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    try {
        return JSON.parse(JSON.stringify(value)) as T;
    } catch {
        return undefined;
    }
}

/** Trim the transparent margins off a character canvas; null if it's blank. */
export function cropCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
    const { width, height } = canvas;
    if (width === 0 || height === 0) {
        return null;
    }

    // Copy the game's canvas onto a scratch canvas of our own. The game
    // created its contexts without willReadFrequently (context attributes
    // only apply on first getContext), so reading its pixels directly is a
    // slow GPU readback and triggers a console warning. The copy is the one
    // readback; the scan and crop below run against CPU-backed memory.
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        return canvas;
    }
    ctx.drawImage(canvas, 0, 0);

    const data = ctx.getImageData(0, 0, width, height).data;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const alpha = data[(y * width + x) * 4 + 3];
            if (alpha !== undefined && alpha > 0) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (maxX === 0 && maxY === 0) {
        return null;
    }

    const croppedWidth = maxX - minX + 1;
    const croppedHeight = maxY - minY + 1;
    const cropped = document.createElement('canvas');
    cropped.width = croppedWidth;
    cropped.height = croppedHeight;

    const croppedCtx = cropped.getContext('2d');
    if (!croppedCtx) {
        return canvas;
    }
    // Crop from the scratch copy — no further reads touch the game's canvas.
    croppedCtx.drawImage(scratch, minX, minY, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
    return cropped;
}
