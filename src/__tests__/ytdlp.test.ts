import path from 'path';
import { text } from 'stream/consumers';
import { __resetForTests, ensureBinary, getInfo, streamFromInfo, YtDlpError } from '../ytdlp';

const FAKE = path.join(__dirname, 'fixtures', 'fake-yt-dlp.js');

describe('yt-dlp wrapper', () => {
    beforeAll(async () => {
        process.env.YTDLP_PATH = FAKE;
        __resetForTests();
        await expect(ensureBinary()).resolves.toBe(FAKE);
    });

    afterAll(() => {
        delete process.env.YTDLP_PATH;
        __resetForTests();
    });

    test('getInfo parses JSON and passes safe defaults', async () => {
        const info = await getInfo('https://www.youtube.com/shorts/abc', ['--user-agent', 'UA']);
        expect(info.id).toBe('abc');
        expect(info.args).toEqual(expect.arrayContaining(['--no-cache-dir', '--js-runtimes', 'node', '--user-agent', 'UA', '-J']));
        // URL is passed after "--" so it can never be read as an option.
        expect(info.args.slice(-2)).toEqual(['--', 'https://www.youtube.com/shorts/abc']);
    });

    test('getInfo rejects with stderr on failure', async () => {
        await expect(getInfo('https://fail')).rejects.toThrow(YtDlpError);
        await expect(getInfo('https://fail')).rejects.toThrow(/unable to extract/);
    });

    test('streamFromInfo streams stdout without touching disk', async () => {
        const { stream } = streamFromInfo({ payload: 'hello video' });
        await expect(text(stream)).resolves.toBe('hello video');
    });

    test('streamFromInfo errors the stream when yt-dlp fails midway', async () => {
        const { stream } = streamFromInfo({ failMidway: true });
        await expect(text(stream)).rejects.toThrow(/connection reset/);
    });

    test('ensureBinary rejects an invalid YTDLP_PATH', async () => {
        process.env.YTDLP_PATH = '/nonexistent/yt-dlp';
        __resetForTests();
        await expect(ensureBinary()).rejects.toThrow(/not a working yt-dlp/);
        process.env.YTDLP_PATH = FAKE;
        __resetForTests();
        await ensureBinary();
    });
});
