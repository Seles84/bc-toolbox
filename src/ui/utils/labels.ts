/**
 * Human-readable labels for the game's numeric levels, ported from the old
 * system's mixin (which matched the game's information sheet wording).
 */
import type { MemberRecord } from '@/shared/records';

export function loverStateLabel(stage?: number): string {
    return ['Dating', 'Engaged', 'Married'][stage ?? -1] ?? 'Unknown';
}

export function collarStateLabel(stage?: number): string {
    return ['On Trial', 'Collared'][stage ?? -1] ?? 'Unknown';
}

export function difficultyLabel(level?: number): string {
    return ['Roleplay', 'Regular', 'Hardcore', 'Extreme'][level ?? -1] ?? 'Unknown';
}

export function permissionLabel(level?: number): string {
    return (
        [
            'Everyone, no exceptions',
            'Everyone, except blacklist',
            'Owner, Lover, whitelist and Dominants',
            'Owner, Lover and whitelist only',
            'Owner and Lover only',
            'Owner only',
        ][level ?? -1] ?? 'Unknown'
    );
}

export function pronounsInfo(pronouns?: string): { name: string; symbol: string } {
    switch (pronouns) {
        case 'SheHer':
            return { name: 'She/Her', symbol: '♀' };
        case 'HeHim':
            return { name: 'He/Him', symbol: '♂' };
        case 'TheyThem':
            return { name: 'They/Them', symbol: '⚧' };
        default:
            return { name: pronouns ?? 'Unknown', symbol: '⚧' };
    }
}

export interface DominanceInfo {
    type: 'Dominant' | 'Submissive' | 'Switch';
    level: number;
}

export function dominanceInfo(member: MemberRecord | null): DominanceInfo {
    const value = member?.reputation?.find((r) => r.Type === 'Dominant')?.Value ?? 0;
    if (value > 0) return { type: 'Dominant', level: value };
    if (value < 0) return { type: 'Submissive', level: -value };
    return { type: 'Switch', level: 0 };
}

export function daysSince(timestamp?: number): number | null {
    if (!timestamp) return null;
    return Math.floor((Date.now() - timestamp) / 86_400_000);
}

/** "3 years, 2 months" style duration since a timestamp. */
export function durationSince(timestamp?: number): string | null {
    const days = daysSince(timestamp);
    if (days === null) return null;
    if (days < 1) return 'today';
    if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
    const months = Math.floor(days / 30.44);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return rest > 0
        ? `${years} year${years === 1 ? '' : 's'}, ${rest} month${rest === 1 ? '' : 's'}`
        : `${years} year${years === 1 ? '' : 's'}`;
}
