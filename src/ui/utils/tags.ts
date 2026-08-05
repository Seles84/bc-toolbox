/** Preset member tags with their chip styling; custom tags get the neutral look. */

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
