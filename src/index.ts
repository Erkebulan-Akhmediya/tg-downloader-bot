import dotenv from 'dotenv';
import { TelegramBot } from './bot';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is required in .env');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);

bot.start().catch(err => {
    console.error('Failed to start bot:', err);
});
