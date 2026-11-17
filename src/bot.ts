import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { InputMediaPhoto, InputMediaVideo } from 'telegraf/types';
import { Readable } from 'stream';
import { BotConfig } from './config';
import { extractLinks, MediaLink } from './links';
import { AlbumItem, BROWSER_UA, resolveMedia, VideoMeta } from './media';
import { TaskQueue } from './queue';
import { MAX_UPLOAD_BYTES, streamFromInfo } from './ytdlp';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // Telegram limit for photos
const MEDIA_GROUP_LIMIT = 10; // Telegram limit for albums

const START_TEXT = 'Скинь ссылку на TikTok, Instagram Reels или YouTube Shorts и бот скачает видео';
const ERROR_TEXT = 'Не удалось скачать видео.';

type MessageContext = Context & { message: { message_id: number; date: number } };

/** True when a message is older than `maxAgeSeconds` (e.g. received while the bot was down). */
export const isStale = (date: number | undefined, maxAgeSeconds: number, nowMs = Date.now()): boolean =>
    typeof date === 'number' && nowMs / 1000 - date > maxAgeSeconds;

const replyParameters = (ctx: MessageContext) => ({
    message_id: ctx.message.message_id,
    allow_sending_without_reply: true,
});

/** Reply options for plain JSON requests (text messages). */
const replyParams = (ctx: MessageContext) => ({ reply_parameters: replyParameters(ctx) });

/**
 * Reply options for file uploads. Telegraf 4.16 silently drops object-valued fields
 * like reply_parameters from multipart requests, so it is sent pre-serialized as JSON
 * (which is exactly what the Bot API expects in multipart bodies).
 */
const uploadReplyParams = (ctx: MessageContext) => ({
    reply_parameters: JSON.stringify(replyParameters(ctx)) as unknown as ReturnType<typeof replyParameters>,
});

const chunk = <T>(items: T[], size: number): T[][] => {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
    return result;
};

interface OpenedItem {
    type: AlbumItem['type'];
    stream: Readable;
}

/** Starts downloading an album item; the body is streamed to Telegram, never buffered whole. */
const openItem = async (item: AlbumItem): Promise<OpenedItem | null> => {
    try {
        const res = await fetch(item.url, {
            headers: { 'User-Agent': BROWSER_UA, ...item.headers },
            signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok || !res.body) {
            console.warn(`Skipping ${item.type}: HTTP ${res.status}`);
            await res.body?.cancel();
            return null;
        }
        const size = Number(res.headers.get('content-length') ?? 0);
        const limit = item.type === 'photo' ? MAX_PHOTO_BYTES : MAX_UPLOAD_BYTES;
        if (size > limit) {
            console.warn(`Skipping ${item.type}: ${size} bytes is over the Telegram limit`);
            await res.body.cancel();
            return null;
        }
        const stream = Readable.fromWeb(res.body as any);
        stream.on('error', () => undefined); // surfaced via upload()
        return { type: item.type, stream };
    } catch (err) {
        console.warn(`Skipping ${item.type}:`, (err as Error).message);
        return null;
    }
};

export class TelegramBot {
    readonly bot: Telegraf;
    private readonly queue: TaskQueue;

    constructor(token: string, private readonly config: BotConfig) {
        this.bot = new Telegraf(token, {
            telegram: config.telegramApiRoot ? { apiRoot: config.telegramApiRoot } : undefined,
        });
        this.queue = new TaskQueue(config.maxConcurrentJobs, config.maxQueueSize);
        this.initializeHandlers();
    }

    private initializeHandlers() {
        // Must be first: drops the backlog that piled up while the bot was offline.
        this.bot.use((ctx, next) => {
            const date = (ctx.msg as { date?: number } | undefined)?.date;
            if (isStale(date, this.config.maxMessageAgeSeconds)) return;
            return next();
        });

        this.bot.start((ctx) => ctx.reply(START_TEXT, replyParams(ctx as MessageContext)));
        this.bot.on(message('text'), (ctx) => this.handleMessage(ctx));

        this.bot.catch((err, ctx) => {
            console.error(`Error while handling ${ctx.updateType}:`, err);
        });
    }

    /** Queues supported links and returns immediately so polling isn't blocked by downloads. */
    handleMessage(ctx: Context): void {
        const msg = ctx.message as { text?: string; entities?: { type: string; url?: string }[] } | undefined;
        if (!msg?.text) return;

        for (const link of extractLinks(msg.text, msg.entities)) {
            const queued = this.queue.push(() => this.processLink(ctx as MessageContext, link));
            if (!queued) console.warn(`Queue is full, dropping ${link.url}`);
        }
    }

    async processLink(ctx: MessageContext, link: MediaLink): Promise<void> {
        try {
            ctx.sendChatAction('upload_video').catch(() => undefined);
            const media = await resolveMedia(link);
            if (media.kind === 'video') {
                await this.sendVideo(ctx, media.info, media.meta);
            } else {
                await this.sendAlbum(ctx, media.items);
            }
        } catch (error) {
            console.error(`Failed to process ${link.url}:`, error);
            await ctx.reply(ERROR_TEXT, replyParams(ctx)).catch(() => undefined);
        }
    }

    /**
     * Uploads files as a reply to the message. Sources are streams, so nothing is buffered
     * in full; if any source fails (e.g. yt-dlp dies midway) the request is aborted
     * instead of sending a truncated file or leaving the connection hanging.
     */
    private async upload(
        ctx: MessageContext,
        method: 'sendVideo' | 'sendPhoto' | 'sendMediaGroup',
        payload: Record<string, unknown>,
        streams: Readable[],
    ): Promise<void> {
        const abort = new AbortController();
        const failed = new Promise<never>((_, reject) =>
            streams.forEach((s) =>
                s.once('error', (err) => {
                    abort.abort();
                    reject(err);
                }),
            ),
        );
        failed.catch(() => undefined);
        const msg = ctx.message as { is_topic_message?: boolean; message_thread_id?: number };
        try {
            await Promise.race([
                ctx.telegram.callApi(
                    method,
                    {
                        chat_id: ctx.chat!.id,
                        message_thread_id: msg.is_topic_message ? msg.message_thread_id : undefined,
                        ...uploadReplyParams(ctx),
                        ...payload,
                    } as any,
                    { signal: abort.signal as any },
                ),
                failed,
            ]);
        } finally {
            for (const s of streams) s.destroy();
        }
    }

    private async sendVideo(ctx: MessageContext, info: unknown, meta: VideoMeta): Promise<void> {
        const download = streamFromInfo(info);
        try {
            await this.upload(
                ctx,
                'sendVideo',
                { video: { source: download.stream, filename: 'video.mp4' }, ...meta, supports_streaming: true },
                [download.stream],
            );
        } finally {
            download.cancel();
        }
    }

    private async sendAlbum(ctx: MessageContext, items: AlbumItem[]): Promise<void> {
        let sent = 0;
        // Albums hold at most 10 items; bigger posts are sent as several albums.
        for (const group of chunk(items, MEDIA_GROUP_LIMIT)) {
            const opened = (await Promise.all(group.map(openItem))).filter((i): i is OpenedItem => i !== null);
            if (opened.length === 0) continue;
            await this.sendOpened(ctx, opened);
            sent += opened.length;
        }
        if (sent === 0) throw new Error('None of the album items could be downloaded');
    }

    private sendOpened(ctx: MessageContext, opened: OpenedItem[]): Promise<void> {
        const streams = opened.map((item) => item.stream);
        if (opened.length === 1) {
            const [item] = opened;
            return item.type === 'photo'
                ? this.upload(ctx, 'sendPhoto', { photo: { source: item.stream, filename: 'photo.jpg' } }, streams)
                : this.upload(
                      ctx,
                      'sendVideo',
                      { video: { source: item.stream, filename: 'video.mp4' }, supports_streaming: true },
                      streams,
                  );
        }
        const media = opened.map((item, i) =>
            item.type === 'photo'
                ? ({ type: 'photo', media: { source: item.stream, filename: `photo${i}.jpg` } } as InputMediaPhoto)
                : ({
                      type: 'video',
                      media: { source: item.stream, filename: `video${i}.mp4` },
                      supports_streaming: true,
                  } as InputMediaVideo),
        );
        return this.upload(ctx, 'sendMediaGroup', { media }, streams);
    }

    /** Starts long polling. Resolves when the bot is stopped, rejects on fatal errors. */
    async start(): Promise<void> {
        console.log('Starting bot in long-polling mode...');
        await this.bot.launch({ allowedUpdates: ['message'] }, () => console.log('Bot started.'));
    }

    stop(reason: string): void {
        try {
            this.bot.stop(reason);
        } catch {
            // not running
        }
    }
}
