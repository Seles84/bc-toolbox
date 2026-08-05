/**
 * In-game overlay: while viewing someone's profile (InformationSheet), a
 * "BCT" button sits beside the game's own top-right button column; clicking
 * it toggles a panel with your tags, note, sighting history, previous names
 * and a live restraint summary for that character.
 *
 * The button/panel are DOM, positioned each frame from the game canvas rect
 * (the game scales its 2000×1000 canvas to the window), so they track
 * resizes exactly like the game's own DOM inputs.
 */
import type { ModSDKModAPI } from 'bondage-club-mod-sdk';
import type { OverlayMemberInfo, PageDataRequest } from '@/shared/protocol';

const BUTTON_ID = 'bct-overlay-button';
const PANEL_ID = 'bct-overlay-panel';
const STYLE_ID = 'bct-overlay-style';

/**
 * Visual styles live in a stylesheet so they can reference the CSS variables
 * the "Themed" mod (ProtoKink/Themed) sets on :root — with Themed active the
 * button/panel adopt the player's theme; the fallbacks match vanilla BC.
 */
const OVERLAY_CSS = `
#${BUTTON_ID} {
    position: fixed;
    z-index: 2147483000;
    padding: 0;
    line-height: 1;
    cursor: pointer;
    background: var(--tmd-element, #fff);
    color: var(--tmd-text, #000);
    border: 2px solid var(--tmd-accent, #000);
    border-radius: 4px;
    font-weight: 700;
    font-family: Arial, sans-serif;
}
#${BUTTON_ID}:hover {
    background: var(--tmd-element-hover, #e0e0e0);
}
#${PANEL_ID} {
    position: fixed;
    z-index: 2147483000;
    overflow-y: auto;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--tmd-main, rgba(18, 18, 18, 0.95));
    border: 1px solid var(--tmd-accent, rgba(255, 255, 255, 0.15));
    color: var(--tmd-text, #e5e5e5);
    font-family: system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.45;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
`;

function ensureStyle(): void {
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = OVERLAY_CSS;
        document.head.appendChild(style);
    }
}

/** Canvas-space geometry: beside the sheet's button column (Exit is 1815,75). */
const BTN = { x: 1705, y: 75, w: 90, h: 90 };
const PANEL = { right: 1690, top: 75, width: 520, maxHeight: 850 };

const TAG_COLORS: Record<string, string> = {
    friend: '#34d399',
    caution: '#fbbf24',
    watch: '#38bdf8',
    avoid: '#fb7185',
};

type RequestData = (request: PageDataRequest) => Promise<unknown>;

let currentInfo: OverlayMemberInfo | null = null;
let currentCharacter: Character | null = null;
let panelOpen = false;

export function initOverlay(mod: ModSDKModAPI, requestData: RequestData): void {
    function cleanup() {
        document.getElementById(BUTTON_ID)?.remove();
        document.getElementById(PANEL_ID)?.remove();
        currentInfo = null;
        currentCharacter = null;
        panelOpen = false;
    }

    async function showFor(character: Character) {
        cleanup();
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
        currentInfo = info;
        currentCharacter = character;

        ensureStyle();
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.textContent = 'BCT';
        button.title = 'BC Toolbox — notes and history';
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            togglePanel();
        });
        document.body.appendChild(button);
        positionAll();
    }

    function togglePanel() {
        panelOpen = !panelOpen;
        document.getElementById(PANEL_ID)?.remove();
        if (panelOpen && currentInfo && currentCharacter) {
            const panel = buildPanel(currentInfo, restraintSummary(currentCharacter));
            document.body.appendChild(panel);
            positionAll();
        }
    }

    mod.hookFunction('InformationSheetLoad', 0, (args, next) => {
        const result = next(args);
        const target = InformationSheetSelection;
        if (target) {
            void showFor(target as Character);
        }
        return result;
    });

    // Track canvas position/scale every frame, like the game's DOM inputs.
    mod.hookFunction('InformationSheetRun', 0, (args, next) => {
        const result = next(args);
        positionAll();
        return result;
    });

    // Any screen change away from the sheet (or into a subscreen) removes it.
    mod.hookFunction('CommonSetScreen', 0, (args, next) => {
        if (args[1] !== 'InformationSheet') {
            cleanup();
        }
        return next(args);
    });
}

/** Map game-canvas coordinates onto the page and apply them. */
function positionAll(): void {
    const button = document.getElementById(BUTTON_ID);
    if (!button) {
        return;
    }
    const canvas = MainCanvas?.canvas;
    if (!canvas) {
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / 2000;

    button.style.left = `${rect.left + BTN.x * scale}px`;
    button.style.top = `${rect.top + BTN.y * scale}px`;
    button.style.width = `${BTN.w * scale}px`;
    button.style.height = `${BTN.h * scale}px`;
    button.style.fontSize = `${Math.max(11, 30 * scale)}px`;

    const panel = document.getElementById(PANEL_ID);
    if (panel) {
        const width = Math.max(280, PANEL.width * scale);
        panel.style.left = `${rect.left + PANEL.right * scale - width}px`;
        panel.style.top = `${rect.top + PANEL.top * scale}px`;
        panel.style.width = `${width}px`;
        panel.style.maxHeight = `${PANEL.maxHeight * scale}px`;
    }
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
    ensureStyle();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    const header = document.createElement('div');
    header.textContent = 'BC TOOLBOX';
    header.style.cssText =
        'font-size:10px;letter-spacing:0.1em;opacity:0.55;margin-bottom:6px;font-weight:600';
    panel.appendChild(header);

    if (restraints) {
        panel.appendChild(line(restraints, { color: '#fda4af' }));
    }

    if (!info.met) {
        panel.appendChild(line('First time meeting this character.', { muted: 0.7, italic: true }));
        return panel;
    }

    if (info.tags.length > 0) {
        const tagRow = document.createElement('div');
        tagRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0';
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
        panel.appendChild(line(seen, { muted: 0.75 }));
    }
    if (info.firstSeen) {
        panel.appendChild(
            line(`First met ${new Date(info.firstSeen).toLocaleDateString()}`, { muted: 0.6 }),
        );
    }
    if (info.previousNames?.length) {
        panel.appendChild(line(`Previously: ${info.previousNames.join(', ')}`, { muted: 0.6 }));
    }

    if (info.note) {
        const note = document.createElement('div');
        note.textContent = info.note.length > 600 ? info.note.slice(0, 600) + '…' : info.note;
        note.style.cssText =
            'margin-top:6px;padding-top:6px;border-top:1px solid var(--tmd-accent, rgba(255,255,255,0.1));white-space:pre-wrap;opacity:0.9';
        panel.appendChild(note);
    }

    return panel;
}

/** Muted lines inherit the theme's text color at reduced opacity. */
function line(
    text: string,
    options: { color?: string; muted?: number; italic?: boolean } = {},
): HTMLDivElement {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = [
        `color:${options.color ?? 'inherit'}`,
        'font-size:12px',
        options.muted !== undefined ? `opacity:${options.muted}` : '',
        options.italic ? 'font-style:italic' : '',
    ]
        .filter(Boolean)
        .join(';');
    return div;
}
