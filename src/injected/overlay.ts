/**
 * In-game overlay: when the player opens someone's profile (InformationSheet),
 * float a small BCT panel with your tags, note, sighting history and previous
 * names for that character — or "first time meeting".
 *
 * Pure DOM with inline styles (the game page has no Tailwind), positioned
 * bottom-right, pointer-events off so it can never block the game.
 */
import type { ModSDKModAPI } from 'bondage-club-mod-sdk';
import type { OverlayMemberInfo, PageDataRequest } from '@/shared/protocol';

const PANEL_ID = 'bct-overlay-panel';

const TAG_COLORS: Record<string, string> = {
    friend: '#34d399',
    caution: '#fbbf24',
    watch: '#38bdf8',
    avoid: '#fb7185',
};

type RequestData = (request: PageDataRequest) => Promise<unknown>;

export function initOverlay(mod: ModSDKModAPI, requestData: RequestData): void {
    function removePanel() {
        document.getElementById(PANEL_ID)?.remove();
    }

    async function showFor(character: Character) {
        removePanel();
        const member = character?.MemberNumber;
        if (!member || member <= 0 || character.IsPlayer() || character.IsNpc()) {
            return;
        }
        const info = (await requestData({ type: 'member-overlay', member })) as OverlayMemberInfo | null;
        if (!info) {
            return;
        }
        // Still on the same profile after the async round-trip?
        if (CurrentScreen !== 'InformationSheet' || InformationSheetSelection?.MemberNumber !== member) {
            return;
        }
        document.body.appendChild(buildPanel(info, restraintSummary(character)));
    }

    mod.hookFunction('InformationSheetLoad', 0, (args, next) => {
        const result = next(args);
        const target = InformationSheetSelection;
        if (target) {
            void showFor(target as Character);
        }
        return result;
    });

    // Any screen change away from the sheet (or into a subscreen) hides it.
    mod.hookFunction('CommonSetScreen', 0, (args, next) => {
        if (args[1] !== 'InformationSheet') {
            removePanel();
        }
        return next(args);
    });
}

/** Live restraint count read straight off the inspected character. */
function restraintSummary(character: Character): string | undefined {
    try {
        let restraints = 0;
        let locked = 0;
        for (const item of character.Appearance ?? []) {
            if (item.Asset.Group.Category === 'Item') {
                restraints++;
                if (item.Property?.LockedBy) locked++;
            }
        }
        if (restraints === 0) {
            return 'No restraints';
        }
        return `${restraints} restraint${restraints === 1 ? '' : 's'}${locked > 0 ? ` (${locked} locked)` : ''}`;
    } catch {
        return undefined;
    }
}

function buildPanel(info: OverlayMemberInfo, restraints?: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
        'position:fixed',
        'right:16px',
        'bottom:16px',
        'z-index:2147483000',
        'max-width:300px',
        'padding:12px 14px',
        'border-radius:10px',
        'background:rgba(18,18,18,0.92)',
        'border:1px solid rgba(255,255,255,0.15)',
        'color:#e5e5e5',
        'font-family:system-ui,sans-serif',
        'font-size:13px',
        'line-height:1.45',
        'pointer-events:none',
        'box-shadow:0 4px 24px rgba(0,0,0,0.4)',
    ].join(';');

    const header = document.createElement('div');
    header.textContent = 'BC TOOLBOX';
    header.style.cssText =
        'font-size:10px;letter-spacing:0.1em;color:#8b8b8b;margin-bottom:6px;font-weight:600';
    panel.appendChild(header);

    if (restraints) {
        panel.appendChild(line(restraints, '#fda4af'));
    }

    if (!info.met) {
        panel.appendChild(line('First time meeting this character.', '#a3a3a3', true));
        return panel;
    }

    if (info.tags.length > 0) {
        const tagRow = document.createElement('div');
        tagRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px';
        for (const tag of info.tags) {
            const chip = document.createElement('span');
            chip.textContent = tag;
            const color = TAG_COLORS[tag.toLowerCase()] ?? '#a3a3a3';
            chip.style.cssText = `padding:1px 7px;border-radius:99px;font-size:11px;font-weight:600;color:${color};border:1px solid ${color}55;background:${color}1a`;
            tagRow.appendChild(chip);
        }
        panel.appendChild(tagRow);
    }

    if (info.lastSeen) {
        const seen = `Last seen ${new Date(info.lastSeen).toLocaleDateString()}${info.lastLocation ? ` in ${info.lastLocation}` : ''}`;
        panel.appendChild(line(seen, '#a3a3a3'));
    }
    if (info.firstSeen) {
        panel.appendChild(line(`First met ${new Date(info.firstSeen).toLocaleDateString()}`, '#8b8b8b'));
    }
    if (info.previousNames?.length) {
        panel.appendChild(line(`Previously: ${info.previousNames.join(', ')}`, '#8b8b8b'));
    }

    if (info.note) {
        const note = document.createElement('div');
        note.textContent = info.note.length > 280 ? info.note.slice(0, 280) + '…' : info.note;
        note.style.cssText =
            'margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);white-space:pre-wrap;color:#d4d4d4';
        panel.appendChild(note);
    }

    return panel;
}

function line(text: string, color: string, italic = false): HTMLDivElement {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = `color:${color};font-size:12px${italic ? ';font-style:italic' : ''}`;
    return div;
}
