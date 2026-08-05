/** Plain-text transcripts of room logs and message threads, for export. */
import type { ChatLogRecord, MemberRecord } from '@/shared/records';

export function downloadText(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

export function safeFilename(value: string): string {
    return value.replace(/[^a-z0-9 _-]/gi, '_').slice(0, 60);
}

function nameOf(members: Map<number, MemberRecord>, memberNumber?: number): string {
    if (!memberNumber) return '[Unknown]';
    const member = members.get(memberNumber);
    return member ? member.nickname || member.name : `#${memberNumber}`;
}

export function formatChatLine(
    line: ChatLogRecord,
    members: Map<number, MemberRecord>,
    viewer?: number,
): string {
    const time = new Date(line.created).toLocaleString();
    const sender = line.senderName ?? nameOf(members, line.sender);
    switch (line.type) {
        case 'Chat':
            return `[${time}] ${sender}: ${line.message}`;
        case 'Whisper': {
            const target =
                line.target ?? (viewer !== undefined && line.sender !== viewer ? viewer : undefined);
            return `[${time}] ${sender} → ${nameOf(members, target)} (whisper): ${line.message}`;
        }
        case 'Emote':
            return `[${time}] *${sender} ${line.message}*`;
        default:
            return `[${time}] (${line.renderedText ?? line.message})`;
    }
}

export function roomTranscript(
    header: string,
    lines: ChatLogRecord[],
    members: Map<number, MemberRecord>,
    viewer?: number,
): string {
    return [header, '', ...lines.map((line) => formatChatLine(line, members, viewer))].join('\n');
}
