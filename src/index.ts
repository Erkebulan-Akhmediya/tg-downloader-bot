import express from 'express';
import dotenv from 'dotenv';
import { TelegramBot } from './bot';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is required in .env');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Telegram Downloader Bot is running (Long Polling).');
});

// Start bot
bot.start().catch(err => {
    console.error('Failed to start bot:', err);
});

// Start Express server (optional, for health checks)
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
