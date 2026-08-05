/**
 * Scheduled automatic backups: a chrome.alarms timer exports the database to
 * the Downloads folder ("BC Toolbox/…"), keeping the newest N files.
 * Settings live in chrome.storage.local under `autoBackup`.
 */
import { db } from '@/shared/db';

const ALARM = 'bct-auto-backup';

export interface BackupSettings {
    enabled: boolean;
    intervalDays: number;
    keep: number;
}

export const BACKUP_DEFAULTS: BackupSettings = { enabled: false, intervalDays: 7, keep: 4 };

export async function getBackupSettings(): Promise<BackupSettings> {
    const stored = await chrome.storage.local.get('autoBackup');
    return { ...BACKUP_DEFAULTS, ...((stored.autoBackup as Partial<BackupSettings>) ?? {}) };
}

async function applyBackupSchedule(): Promise<void> {
    const settings = await getBackupSettings();
    await chrome.alarms.clear(ALARM);
    if (settings.enabled) {
        chrome.alarms.create(ALARM, {
            periodInMinutes: Math.max(1, settings.intervalDays) * 1440,
            delayInMinutes: 5,
        });
    }
}

export function initBackups(): void {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === ALARM) {
            runBackup().catch((error) => console.error('[BCT] auto-backup failed', error));
        }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.autoBackup) {
            void applyBackupSchedule();
        }
    });
    void applyBackupSchedule();
}

async function runBackup(): Promise<void> {
    const dump: Record<string, unknown[]> = {};
    for (const table of db.tables) {
        dump[table.name] = await table.toArray();
    }
    const json = JSON.stringify({ format: 'bc-toolbox', version: 1, data: dump });
    const stamp = new Date().toISOString().slice(0, 10);

    await chrome.downloads.download({
        url: 'data:application/json;base64,' + toBase64(json),
        filename: `BC Toolbox/bc-toolbox-backup-${stamp}.json`,
        conflictAction: 'uniquify',
    });
    await chrome.storage.local.set({ lastAutoBackup: Date.now() });

    // Retention: drop the oldest automatic backups beyond the keep count.
    const settings = await getBackupSettings();
    const items = await chrome.downloads.search({
        filenameRegex: 'bc-toolbox-backup-.*\\.json',
        orderBy: ['-startTime'],
        limit: 100,
    });
    for (const item of items.slice(Math.max(1, settings.keep))) {
        try {
            await chrome.downloads.removeFile(item.id);
            await chrome.downloads.erase({ id: item.id });
        } catch {
            // File already gone (moved/deleted by the user) — fine.
        }
    }
}

/** Service workers have no URL.createObjectURL — encode as a data URL. */
function toBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}
