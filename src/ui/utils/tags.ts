/** Preset member tags with their chip styling; custom tags get the neutral look. */
import type { MemberRecord } from '@/shared/records';

export const PRESET_TAGS = [
    { tag: 'Friend', class: 'bg-emerald-500/20 text-emerald-300' },
    { tag: 'Caution', class: 'bg-amber-500/20 text-amber-300' },
    { tag: 'Watch', class: 'bg-sky-500/20 text-sky-300' },
    { tag: 'Avoid', class: 'bg-rose-500/20 text-rose-300' },
] as const;

export function tagClass(tag: string): string {
    return (
        PRESET_TAGS.find((preset) => preset.tag.toLowerCase() === tag.toLowerCase())?.class ??
        'bg-neutral-500/20 text-neutral-300'
    );
}

// -- Auto tags ---------------------------------------------------------------

/**
 * Tags derived from the viewing character's own relationship lists (owner,
 * lovers, submissives, friend/white/black/ghost lists) rather than typed in
 * by hand. Ringed chips so they read as automatic at a glance.
 */
export interface AutoTag {
    tag: string;
    class: string;
    title: string;
}

const AUTO = {
    owner: {
        tag: 'Owner',
        class: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/40',
        title: 'Your owner',
    },
    lover: {
        tag: 'Lover',
        class: 'bg-pink-500/15 text-pink-300 ring-1 ring-pink-400/40',
        title: 'One of your lovers',
    },
    submissive: {
        tag: 'Submissive',
        class: 'bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-fuchsia-400/40',
        title: 'One of your submissives',
    },
    friend: {
        tag: 'Friend',
        class: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/40',
        title: 'On your friend list',
    },
    whitelist: {
        tag: 'Whitelist',
        class: 'bg-teal-500/15 text-teal-300 ring-1 ring-teal-400/40',
        title: 'On your whitelist',
    },
    blacklist: {
        tag: 'Blacklist',
        class: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/40',
        title: 'On your blacklist',
    },
    ghosted: {
        tag: 'Ghosted',
        class: 'bg-neutral-500/15 text-neutral-400 ring-1 ring-neutral-400/40',
        title: 'On your ghost list',
    },
} as const satisfies Record<string, AutoTag>;

/** Auto tags that apply to `member`, from the viewer's own captured record. */
export function autoTagsFor(viewer: MemberRecord | null | undefined, member: number): AutoTag[] {
    if (!viewer || viewer.memberNumber === member) {
        return [];
    }
    const tags: AutoTag[] = [];
    if (viewer.ownership?.MemberNumber === member) tags.push(AUTO.owner);
    if (viewer.lovership?.some((l) => l.MemberNumber === member)) tags.push(AUTO.lover);
    if (viewer.submissives?.includes(member)) tags.push(AUTO.submissive);
    if (viewer.friends && String(member) in viewer.friends) tags.push(AUTO.friend);
    if (viewer.whitelist?.includes(member)) tags.push(AUTO.whitelist);
    if (viewer.blacklist?.includes(member)) tags.push(AUTO.blacklist);
    if (viewer.ghostlist?.includes(member)) tags.push(AUTO.ghosted);
    return tags;
}

/** Auto tag names the viewer's record can currently produce (for filters). */
export function availableAutoTags(viewer: MemberRecord | null | undefined): string[] {
    if (!viewer) {
        return [];
    }
    const names: string[] = [];
    if (viewer.ownership?.MemberNumber) names.push(AUTO.owner.tag);
    if (viewer.lovership?.some((l) => l.MemberNumber)) names.push(AUTO.lover.tag);
    if (viewer.submissives?.length) names.push(AUTO.submissive.tag);
    if (viewer.friends && Object.keys(viewer.friends).length) names.push(AUTO.friend.tag);
    if (viewer.whitelist?.length) names.push(AUTO.whitelist.tag);
    if (viewer.blacklist?.length) names.push(AUTO.blacklist.tag);
    if (viewer.ghostlist?.length) names.push(AUTO.ghosted.tag);
    return names;
}
