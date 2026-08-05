/**
 * The game compresses long profile descriptions before storing them: when
 * LZString-compression wins, the Description field becomes '╬' (char 9580) +
 * compressToUTF16(text) — which looks like unicode gibberish if shown raw
 * (see OnlineProfile.js, ONLINE_PROFILE_DESCRIPTION_COMPRESSION_MAGIC).
 */
import { decompressFromUTF16 } from 'lz-string';

const COMPRESSION_MAGIC = String.fromCharCode(9580);

export function decodeDescription(description: string | undefined): string | undefined {
    if (!description || !description.startsWith(COMPRESSION_MAGIC)) {
        return description;
    }
    try {
        return decompressFromUTF16(description.slice(1)) || description;
    } catch {
        return description;
    }
}
