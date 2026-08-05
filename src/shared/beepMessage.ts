/**
 * Beep Message payloads come in several shapes:
 *   - plain text
 *   - WCE/FBC instant messenger: text + "\n\n{json}" — a metadata line
 *     prefixed with the private-use char U+F124 (invisible in most fonts)
 *   - text followed by a bare JSON metadata line
 *   - pure JSON (metadata only, no text)
 * Split them into displayable text + parsed metadata.
 */

export interface BeepMeta {
    messageType?: string;
    messageColor?: string;
    [key: string]: unknown;
}

const ADDON_META_PREFIX = '';

export function parseBeepMessage(raw: unknown): { text?: string; meta?: BeepMeta } {
    if (typeof raw !== 'string' || raw.length === 0) {
        return {};
    }

    // WCE/FBC instant messenger: metadata on a U+F124-prefixed line.
    if (raw.includes(ADDON_META_PREFIX)) {
        const lines = raw.split('\n');
        const metaLine = lines.find((line) => line.startsWith(ADDON_META_PREFIX));
        const meta = metaLine ? tryParse(metaLine.slice(1)) : undefined;
        if (meta) {
            const text = lines
                .filter((line) => !line.startsWith(ADDON_META_PREFIX))
                .join('\n')
                .trim();
            return { text: text || undefined, meta };
        }
    }

    const trimmed = raw.trim();

    // Pure JSON message.
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const meta = tryParse(trimmed);
        if (meta) {
            return { meta };
        }
    }

    // Text with a trailing bare-JSON metadata block.
    const jsonStart = trimmed.lastIndexOf('\n{');
    if (jsonStart >= 0 && trimmed.endsWith('}')) {
        const meta = tryParse(trimmed.slice(jsonStart + 1));
        if (meta) {
            const text = trimmed.slice(0, jsonStart).trim();
            return { text: text || undefined, meta };
        }
    }

    return { text: trimmed };
}

/** Compose a Message in the WCE instant-messenger format. */
export function composeBeepMessage(text: string, meta: BeepMeta): string {
    return `${text}\n\n${ADDON_META_PREFIX}${JSON.stringify(meta)}`;
}

function tryParse(value: string): BeepMeta | undefined {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as BeepMeta;
        }
    } catch {
        // Not JSON after all — treat as text.
    }
    return undefined;
}
