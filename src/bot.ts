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
        this.bot.start((ctx) => ctx.reply('Welcome! Send me a TikTok or Instagram Reels link to download.'));
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
                await ctx.reply('Processing your link...');

                // Get Info first to get metadata (like title/ext)?
                // Or just stream it. Let's try to get info to send a caption if needed or filename options.
                // For simplicity, just stream.

                const stream = downloadStream(text);

                // Send video
                // ctx.replyWithVideo expects source to be fs.createReadStream or buffer or url.
                // It supports Readable stream.
                await ctx.replyWithVideo({ source: stream }, { caption: 'Here is your video!' });

            } catch (error) {
                console.error('Download error:', error);
                await ctx.reply('Sorry, detailed error: ' + (error instanceof Error ? error.message : String(error)));
            }
        } else {
            // Optional: Reply that link is not supported or ignore
            // await ctx.reply('Please send a valid TikTok or Instagram Reel link.');
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
