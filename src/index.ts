import { TelegramBot } from './bot';
import { loadConfig } from './config';
import { ensureBinary, killAll } from './ytdlp';

// Load .env for local development (Docker passes variables directly).
try {
    process.loadEnvFile();
} catch {
    // no .env file
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is required (set it in .env or the environment)');
    process.exit(1);
}

// Exit on unexpected failures so the container's restart policy brings the bot back.
const fail = (err: unknown) => {
    console.error('Fatal error:', err);
    killAll();
    process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const main = async () => {
    const binary = await ensureBinary();
    console.log(`Using yt-dlp: ${binary}`);

    const bot = new TelegramBot(BOT_TOKEN, loadConfig());
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
            killAll();
            bot.stop(signal);
        });
    }

    await bot.start();
    console.log('Bot stopped.');
    process.exit(0);
};

main().catch(fail);
