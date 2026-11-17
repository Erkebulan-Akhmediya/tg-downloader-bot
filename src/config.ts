const readInt = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0) {
        console.warn(`Ignoring invalid ${name}=${raw}, using ${fallback}`);
        return fallback;
    }
    return value;
};

export interface BotConfig {
    /** Messages older than this (in seconds) are ignored, e.g. the backlog after downtime. */
    maxMessageAgeSeconds: number;
    /** How many links are downloaded/uploaded at the same time. */
    maxConcurrentJobs: number;
    /** How many links may wait in the queue; extra links are dropped. */
    maxQueueSize: number;
    /** Optional custom Bot API server (e.g. a self-hosted telegram-bot-api). */
    telegramApiRoot?: string;
}

export const loadConfig = (): BotConfig => ({
    maxMessageAgeSeconds: readInt('MAX_MESSAGE_AGE_SECONDS', 300),
    maxConcurrentJobs: Math.max(1, readInt('MAX_CONCURRENT_JOBS', 2)),
    maxQueueSize: Math.max(1, readInt('MAX_QUEUE_SIZE', 50)),
    telegramApiRoot: process.env.TELEGRAM_API_ROOT || undefined,
});
