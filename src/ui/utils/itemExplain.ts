/**
 * Human-readable breakdown of a captured raw item bundle (WornItem.raw):
 * effect explanations, timer formatting, and loose typing for the blob.
 */

/** The shape stored by the injected capture in WornItem.raw. */
export interface RawItemBundle {
    Group?: string;
    Name?: string;
    Color?: string | string[];
    Difficulty?: number;
    Property?: RawItemProperty;
    Craft?: RawItemCraft;
}

export interface RawItemProperty {
    Type?: string | null;
    TypeRecord?: Record<string, number>;
    Effect?: string[];
    SetPose?: string[];
    Difficulty?: number;
    Intensity?: number;
    LockedBy?: string;
    LockMemberNumber?: number | string;
    Password?: string;
    CombinationNumber?: string | number;
    RemoveTimer?: number;
    ShowTimer?: boolean;
    RemoveItem?: boolean;
    Text?: string;
    Text2?: string;
    Text3?: string;
    [key: string]: unknown;
}

export interface RawItemCraft {
    Name?: string;
    Description?: string;
    MemberName?: string;
    MemberNumber?: number;
    Property?: string;
    Lore?: string;
    Private?: boolean;
    [key: string]: unknown;
}

export function rawOf(raw: unknown): RawItemBundle | null {
    return raw && typeof raw === 'object' ? (raw as RawItemBundle) : null;
}

/** Friendly one-liners for the game's item effects. */
const EFFECT_INFO: Record<string, string> = {
    Freeze: 'Rooted to the spot — cannot walk',
    Block: 'Fully bound — most interactions blocked',
    BlockWardrobe: 'Cannot change clothes',
    Mounted: 'Mounted in place',
    CuffedFeet: 'Feet cuffed together',
    CuffedLegs: 'Legs cuffed together',
    CuffedArms: 'Arms cuffed together',
    IsChained: 'Chained up',
    FixedHead: 'Head held in place',
    MergedFingers: 'Fingers merged — no fine handling',
    Shackled: 'Shackled',
    Tethered: 'Tethered — cannot leave the spot',
    MapImmobile: 'Cannot move on the room map',
    MapSwim: 'Can swim on the room map',
    Enclose: 'Enclosed away from the room',
    OneWayEnclose: 'Enclosed — others can peek in',
    OnBed: 'On a bed',
    Lifted: 'Lifted off the ground',
    Suspended: 'Suspended',
    Slow: 'Slowed — leaving takes longer',
    FillVulva: 'Vaginally penetrated',
    IsPlugged: 'Anally plugged',
    Egged: 'Wearing a vibrator',
    Vibrating: 'Actively vibrating',
    Edged: 'Kept on the edge',
    DenialMode: 'Orgasm denial',
    RuinOrgasms: 'Orgasms are ruined',
    Remote: 'Remote-controllable',
    UseRemote: 'Can use remotes',
    BlockRemotes: 'Remotes are blocked',
    Lock: 'Lockable',
    NotSelfPickable: 'Lock cannot be self-picked',
    Chaste: 'In chastity',
    BreastChaste: 'Breasts in chastity',
    ButtChaste: 'Rear in chastity',
    Leash: 'Has a leash point',
    IsLeashed: 'On a leash',
    CrotchRope: 'Crotch rope stimulation',
    ReceiveShock: 'Can receive shocks',
    TriggerShock: 'Triggers shocks',
    BlockMouth: 'Mouth blocked for items',
    OpenMouth: 'Mouth held open',
    ProtrudingMouth: 'Something protrudes from the mouth',
    RegressedTalk: 'Forces baby talk',
    HideRestraints: 'Hides restraints beneath',
    Wiggling: 'Dangles and wiggles',
    CanEdge: 'Can be used to edge',
};

const TIER_WORDS: Record<string, string> = {
    VeryLight: 'very light',
    Easy: 'easy',
    Light: 'light',
    Normal: 'normal',
    Heavy: 'heavy',
    VeryHeavy: 'very heavy',
    Total: 'total',
    Total2: 'total+',
    Total3: 'total++',
    Total4: 'total+++',
};

/** Friendly description for one effect name; falls back to the raw name. */
export function effectInfo(effect: string): { label: string; desc: string } {
    const known = EFFECT_INFO[effect];
    if (known) return { label: effect, desc: known };
    for (const [prefix, what] of [
        ['Gag', 'Muffles speech'],
        ['Blind', 'Blocks sight'],
        ['Blur', 'Blurs vision'],
        ['Deaf', 'Muffles hearing'],
    ] as const) {
        if (effect.startsWith(prefix)) {
            const tier = TIER_WORDS[effect.slice(prefix.length)];
            if (tier) return { label: effect, desc: `${what} (${tier})` };
        }
    }
    if (effect.startsWith('Unlock')) {
        return { label: effect, desc: `Opens: ${effect.slice(6).replace(/([a-z])([A-Z])/g, '$1 $2')}` };
    }
    return { label: effect, desc: '' };
}

/** "2d 4h", "2h 13m", "5m 30s", "42s" */
export function formatDuration(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86_400);
    const h = Math.floor((s % 86_400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}
