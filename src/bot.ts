import { Telegraf, Context } from 'telegraf';
import { downloadStream, ensureBinary, getVideoInfo } from './downloader';


export class TelegramBot {
    private bot: Telegraf;

    constructor(token: string) {
        this.bot = new Telegraf(token);
        this.initializeHandlers();
        // Ensure binary is ready when bot starts
        ensureBinary().catch(err => console.error('Failed to download yt-dlp binary:', err));
    }

    private initializeHandlers() {
        this.bot.start(
            (ctx) => ctx.reply('Скинь ссылку на TikTok или Instagram Reels и бот скачает видео')
        );
        this.bot.on('text', this.handleMessage.bind(this));

        // Error handling
        this.bot.catch((err, ctx) => {
            console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
        });
    }

    private async handleMessage(ctx: Context) {
        // @ts-ignore
        const text = ctx.message?.text;
        if (!text) return;

        // Regex for TikTok and Instagram Reels
        const tiktokRegex = /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com\/|vm\.tiktok\.com\/)(?:@[\w.-]+\/video\/\d+|[\w-]+)/;
        const instagramRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reel|p)\/[\w-]+\/?/;

        const isTikTok = tiktokRegex.test(text);
        const isInstagram = instagramRegex.test(text);

        if (isTikTok || isInstagram) {
            try {
                const stream = downloadStream(text);
                await ctx.replyWithVideo({ source: stream });
            } catch (error) {
                console.error('Download error:', error);
                await ctx.reply('Не удалось скачать видео.');
            }
        }
    }

    public async start() {
        console.log('Starting bot in long-polling mode...');
        await this.bot.launch();
        console.log('Bot started.');

        // Enable graceful stop
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}
