import { albumFromInfo, parseTikTokImages, resolveMedia } from '../media';
import { getInfo } from '../ytdlp';

jest.mock('../ytdlp', () => ({ getInfo: jest.fn() }));

const mockGetInfo = getInfo as jest.Mock;

const tiktokPage = (images: string[][]) =>
    `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
        __DEFAULT_SCOPE__: {
            'webapp.video-detail': {
                itemInfo: { itemStruct: { imagePost: { images: images.map((urlList) => ({ imageURL: { urlList } })) } } },
            },
        },
    })}</script></html>`;

const response = (body: string, init: ResponseInit = {}) => new Response(body, init);

describe('media resolution', () => {
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
        mockGetInfo.mockReset();
        fetchMock = jest.spyOn(global, 'fetch');
    });

    afterEach(() => fetchMock.mockRestore());

    test('parseTikTokImages prefers jpeg variants', () => {
        const html = tiktokPage([
            ['https://p16/a.webp?x=1', 'https://p16/a.jpeg?x=1'],
            ['https://p16/b~tplv-photomode-image.jpeg?x=2'],
        ]);
        expect(parseTikTokImages(html)).toEqual(['https://p16/a.jpeg?x=1', 'https://p16/b~tplv-photomode-image.jpeg?x=2']);
        expect(parseTikTokImages('<html>captcha</html>')).toEqual([]);
    });

    test('albumFromInfo handles Instagram carousels with photos and videos', () => {
        const info = {
            _type: 'playlist',
            entries: [
                { thumbnails: [{ url: 'https://ig/small.jpg', width: 150 }, { url: 'https://ig/big.jpg', width: 1080 }], formats: [] },
                { url: 'https://ig/clip.mp4', vcodec: 'avc1', http_headers: { Referer: 'x' } },
                { thumbnail: 'https://ig/only.jpg' },
            ],
        };
        expect(albumFromInfo(info)).toEqual([
            { type: 'photo', url: 'https://ig/big.jpg', headers: { Referer: 'https://www.instagram.com/' } },
            { type: 'video', url: 'https://ig/clip.mp4', headers: { Referer: 'x' } },
            { type: 'photo', url: 'https://ig/only.jpg', headers: { Referer: 'https://www.instagram.com/' } },
        ]);
    });

    test('TikTok video goes through yt-dlp', async () => {
        const info = { url: 'https://cdn/v.mp4', vcodec: 'h264', width: 1080, height: 1920, duration: 14.6 };
        mockGetInfo.mockResolvedValue(info);
        const result = await resolveMedia({ platform: 'tiktok', url: 'https://www.tiktok.com/@u/video/1' });
        expect(result).toEqual({ kind: 'video', info, meta: { width: 1080, height: 1920, duration: 15 } });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('TikTok short link is resolved and photo posts become an album', async () => {
        fetchMock
            .mockResolvedValueOnce(response('', { status: 301, headers: { location: 'https://www.tiktok.com/@u/photo/42?_r=1' } }))
            .mockResolvedValueOnce(response('', { status: 200 }))
            .mockResolvedValueOnce(response(tiktokPage([['https://p16/1.jpeg'], ['https://p16/2.jpeg']])));

        const result = await resolveMedia({ platform: 'tiktok', url: 'https://vm.tiktok.com/ZMabc' });

        expect(fetchMock.mock.calls[2][0]).toBe('https://www.tiktok.com/@u/photo/42');
        expect(mockGetInfo).not.toHaveBeenCalled();
        expect(result).toEqual({
            kind: 'album',
            items: [
                { type: 'photo', url: 'https://p16/1.jpeg', headers: { Referer: 'https://www.tiktok.com/' } },
                { type: 'photo', url: 'https://p16/2.jpeg', headers: { Referer: 'https://www.tiktok.com/' } },
            ],
        });
    });

    test('TikTok slideshow behind a /video/ URL (audio only) becomes an album, with tikwm fallback', async () => {
        mockGetInfo.mockResolvedValue({ url: 'https://cdn/a.mp3', vcodec: 'none' });
        fetchMock
            .mockResolvedValueOnce(response('<html>challenge</html>'))
            .mockResolvedValueOnce(response(JSON.stringify({ code: 0, data: { images: ['https://tikwm/1.jpg'] } })));

        const result = await resolveMedia({ platform: 'tiktok', url: 'https://www.tiktok.com/@u/video/7' });

        expect(String(fetchMock.mock.calls[1][0])).toContain('tikwm.com');
        expect(result).toEqual({
            kind: 'album',
            items: [{ type: 'photo', url: 'https://tikwm/1.jpg', headers: { Referer: 'https://www.tiktok.com/' } }],
        });
    });

    test('Instagram reel is a video, carousel is an album', async () => {
        mockGetInfo.mockResolvedValueOnce({ url: 'https://ig/v.mp4', vcodec: 'avc1' });
        await expect(resolveMedia({ platform: 'instagram', url: 'https://www.instagram.com/reel/a' })).resolves.toMatchObject({
            kind: 'video',
        });
        expect(mockGetInfo.mock.calls[0][1]).toContain('--ignore-no-formats-error');

        mockGetInfo.mockResolvedValueOnce({ _type: 'playlist', entries: [{ thumbnail: 'https://ig/1.jpg' }, { thumbnail: 'https://ig/2.jpg' }] });
        await expect(resolveMedia({ platform: 'instagram', url: 'https://www.instagram.com/p/b' })).resolves.toMatchObject({
            kind: 'album',
            items: [{ url: 'https://ig/1.jpg' }, { url: 'https://ig/2.jpg' }],
        });
    });

    test('YouTube Shorts are videos; audio-only results are rejected', async () => {
        mockGetInfo.mockResolvedValueOnce({ url: 'https://yt/v.mp4', vcodec: 'avc1', width: 720, height: 1280 });
        await expect(resolveMedia({ platform: 'youtube', url: 'https://www.youtube.com/shorts/x' })).resolves.toMatchObject({
            kind: 'video',
            meta: { width: 720, height: 1280 },
        });
        mockGetInfo.mockResolvedValueOnce({ url: 'https://yt/a.m4a', vcodec: 'none' });
        await expect(resolveMedia({ platform: 'youtube', url: 'https://www.youtube.com/shorts/y' })).rejects.toThrow();
    });
});
