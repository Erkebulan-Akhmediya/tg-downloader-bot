import http from 'http';
import { AddressInfo } from 'net';
import path from 'path';
import { TelegramBot, isStale } from '../bot';
import { resolveMedia } from '../media';
import { __resetForTests, ensureBinary } from '../ytdlp';

jest.mock('../media', () => ({ ...jest.requireActual('../media'), resolveMedia: jest.fn() }));
const mockResolve = resolveMedia as jest.Mock;

interface ApiCall {
    method: string;
    body: string;
}

/** Fake Telegram Bot API + CDN on localhost. */
const startFakeServer = async (updates: unknown[]) => {
    const calls: ApiCall[] = [];
    let delivered = false;
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('error', () => undefined);
        req.on('end', () => {
            const url = req.url ?? '';
            if (url.startsWith('/cdn/')) {
                if (url.includes('missing')) return res.writeHead(404).end();
                return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(`IMAGE:${url}`);
            }
            const method = url.split('/').pop() as string;
            calls.push({ method, body: Buffer.concat(chunks).toString('utf8') });
            const reply = (result: unknown) =>
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }));
            switch (method) {
                case 'getMe':
                    return reply({ id: 1, is_bot: true, first_name: 'Test', username: 'test_bot' });
                case 'getUpdates':
                    if (!delivered) {
                        delivered = true;
                        return reply(updates);
                    }
                    return setTimeout(() => reply([]), 100);
                default:
                    return reply(method === 'sendMediaGroup' ? [] : true);
            }
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { server, calls, base };
};

const waitFor = async (check: () => boolean, timeoutMs = 10_000) => {
    const started = Date.now();
    while (!check()) {
        if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition');
        await new Promise((r) => setTimeout(r, 25));
    }
};

const now = () => Math.floor(Date.now() / 1000);
const chat = { id: -100123, type: 'supergroup', title: 'Group' };
const msg = (message_id: number, text: string, date = now()) => ({
    update_id: message_id,
    message: { message_id, date, chat, from: { id: 7, is_bot: false, first_name: 'U' }, text },
});

describe('isStale', () => {
    test('uses the 5 minute window', () => {
        const nowMs = 1_000_000_000;
        expect(isStale(nowMs / 1000 - 299, 300, nowMs)).toBe(false);
        expect(isStale(nowMs / 1000 - 301, 300, nowMs)).toBe(true);
        expect(isStale(undefined, 300, nowMs)).toBe(false);
    });
});

describe('TelegramBot end-to-end (fake Telegram API)', () => {
    beforeAll(async () => {
        process.env.YTDLP_PATH = path.join(__dirname, 'fixtures', 'fake-yt-dlp.js');
        __resetForTests();
        await ensureBinary();
    });

    test('skips stale messages and replies with videos, albums and errors', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);

        const { server, calls, base } = await startFakeServer([
            msg(10, 'old https://www.tiktok.com/@u/video/10', now() - 10 * 60), // sent while bot was down
            { ...msg(11, 'https://www.tiktok.com/@u/video/11'), message: { ...msg(11, 'https://www.tiktok.com/@u/video/11').message, is_topic_message: true, message_thread_id: 5 } },
            msg(12, 'https://www.instagram.com/p/album12/'),
            msg(13, 'https://www.youtube.com/shorts/aaaaaaaaaaa'),
            msg(14, 'just chatting'),
        ]);

        mockResolve.mockImplementation(async (link: { url: string }) => {
            if (link.url.includes('/video/11')) {
                return { kind: 'video', info: { payload: 'VIDEO-11' }, meta: { width: 720, height: 1280, duration: 9 } };
            }
            if (link.url.includes('album12')) {
                return {
                    kind: 'album',
                    items: [
                        { type: 'photo', url: `${base}/cdn/1.jpg` },
                        { type: 'photo', url: `${base}/cdn/missing.jpg` },
                        { type: 'photo', url: `${base}/cdn/3.jpg` },
                    ],
                };
            }
            return { kind: 'video', info: { failMidway: true }, meta: {} };
        });

        const bot = new TelegramBot('123:TEST', {
            maxMessageAgeSeconds: 300,
            maxConcurrentJobs: 2,
            maxQueueSize: 10,
            telegramApiRoot: base,
        });
        const running = bot.start();

        try {
            await waitFor(
                () =>
                    calls.some((c) => c.method === 'sendVideo') &&
                    calls.some((c) => c.method === 'sendMediaGroup') &&
                    calls.some((c) => c.method === 'sendMessage'),
            );

            // Stale message (10) and message without links (14) are ignored completely.
            const resolvedUrls = mockResolve.mock.calls.map(([l]) => l.url).sort();
            expect(resolvedUrls).toEqual([
                'https://www.instagram.com/p/album12',
                'https://www.tiktok.com/@u/video/11',
                'https://www.youtube.com/shorts/aaaaaaaaaaa',
            ]);
            expect(calls.filter((c) => c.method.startsWith('send') && c.method !== 'sendChatAction')).toHaveLength(3);

            const video = calls.find((c) => c.method === 'sendVideo')!.body;
            expect(video).toContain('VIDEO-11');
            expect(video).toMatch(/name="reply_parameters"[\s\S]*"message_id":11/);
            expect(video).toMatch(/name="width"\r\n\r\n720/);
            expect(video).toMatch(/name="message_thread_id"\r\n\r\n5/); // forum topics
            expect(video).toMatch(/name="supports_streaming"\r\n\r\ntrue/);

            const album = calls.find((c) => c.method === 'sendMediaGroup')!.body;
            expect(album).toMatch(/name="reply_parameters"[\s\S]*"message_id":12/);
            expect(album).toContain('IMAGE:/cdn/1.jpg');
            expect(album).toContain('IMAGE:/cdn/3.jpg');
            expect(album).not.toContain('missing');
            const mediaField = album.match(/name="media"\r\n\r\n(.*)\r\n/)![1];
            expect(JSON.parse(mediaField)).toHaveLength(2);

            const error = JSON.parse(calls.find((c) => c.method === 'sendMessage')!.body);
            expect(error.text).toBe('Не удалось скачать видео.');
            expect(error.reply_parameters).toMatchObject({ message_id: 13 });
        } finally {
            bot.stop('test');
            await running;
            server.closeAllConnections();
            server.close();
            jest.restoreAllMocks();
        }
    }, 20_000);
});
