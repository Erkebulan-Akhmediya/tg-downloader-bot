import { TelegramBot } from '../bot';
import { Context } from 'telegraf';
import { downloadStream } from '../downloader';
import { Readable } from 'stream';

// Mock downloader
jest.mock('../downloader', () => ({
    downloadStream: jest.fn(),
    ensureBinary: jest.fn().mockResolvedValue(undefined),
    getVideoInfo: jest.fn()
}));

// Access private method for testing or expose a helper?
// Since handleMessage is private, we can mock Telegraf or test the regex separately?
// Or we can just access it via prototype or `any`.
// Better: check if we can test the regex logic by extracting it or using the handleMessage via binding.

describe('TelegramBot', () => {
    let bot: TelegramBot;
    let mockCtx: Partial<Context>;
    let mockReply: jest.Mock;
    let mockReplyWithVideo: jest.Mock;

    beforeEach(() => {
        // Mock Telegraf constructor if needed, but we can just instantiation
        // We'll need to mock the Telegraf instance inside wrapper if we want to prevent real network calls.
        // Actually, Telegraf constructor makes no calls.
        bot = new TelegramBot('TEST_TOKEN');

        mockReply = jest.fn();
        mockReplyWithVideo = jest.fn();

        mockCtx = {
            // @ts-ignore
            message: {
                text: ''
            },
            reply: mockReply,
            replyWithVideo: mockReplyWithVideo,
            updateType: 'message'
        };
    });

    const triggerHandleMessage = async (text: string) => {
        // @ts-ignore
        mockCtx.message.text = text;
        // @ts-ignore
        await bot.handleMessage(mockCtx);
    };

    test('should ignore non-link messages', async () => {
        await triggerHandleMessage('hello world');
        expect(mockReply).not.toHaveBeenCalled();
        expect(mockReplyWithVideo).not.toHaveBeenCalled();
    });

    test('should detect TikTok links', async () => {
        (downloadStream as jest.Mock).mockReturnValue(Readable.from(['fake data']));

        await triggerHandleMessage('Check this out: https://www.tiktok.com/@user/video/1234567890');

        expect(mockReply).toHaveBeenCalledWith('Processing your link...');
        expect(downloadStream).toHaveBeenCalledWith(expect.stringContaining('https://www.tiktok.com/@user/video/1234567890'));
        expect(mockReplyWithVideo).toHaveBeenCalled();
    });

    test('should detect Instagram Reel links', async () => {
        (downloadStream as jest.Mock).mockReturnValue(Readable.from(['fake data']));

        await triggerHandleMessage('https://www.instagram.com/reel/C-abc123/');

        expect(mockReply).toHaveBeenCalledWith('Processing your link...');
        expect(downloadStream).toHaveBeenCalledWith(expect.stringContaining('https://www.instagram.com/reel/C-abc123/'));
        expect(mockReplyWithVideo).toHaveBeenCalled();
    });

    test('should handle download errors', async () => {
        (downloadStream as jest.Mock).mockImplementation(() => {
            throw new Error('Download failed');
        });

        await triggerHandleMessage('https://www.tiktok.com/@user/video/123');

        expect(mockReply).toHaveBeenCalledWith('Processing your link...');
        // Should reply with error
        expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Sorry, detailed error: Download failed'));
    });
});
