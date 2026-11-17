import { extractLinks, MAX_LINKS_PER_MESSAGE } from '../links';

const urls = (text: string, entities?: { type: string; url?: string }[]) =>
    extractLinks(text, entities).map((l) => `${l.platform} ${l.url}`);

describe('extractLinks', () => {
    test('ignores messages without supported links', () => {
        expect(urls('hello world https://example.com/video/1')).toEqual([]);
        expect(urls('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual([]);
        expect(urls('https://www.instagram.com/someuser/')).toEqual([]);
    });

    test.each([
        ['https://www.tiktok.com/@user.name/video/7312345678901234567?is_from_webapp=1', 'tiktok https://www.tiktok.com/@user.name/video/7312345678901234567'],
        ['https://www.tiktok.com/@user/photo/7312345678901234567', 'tiktok https://www.tiktok.com/@user/photo/7312345678901234567'],
        ['https://vm.tiktok.com/ZMabc123/', 'tiktok https://vm.tiktok.com/ZMabc123'],
        ['https://vt.tiktok.com/ZSabc123/', 'tiktok https://vt.tiktok.com/ZSabc123'],
        ['https://www.tiktok.com/t/ZTabc123/', 'tiktok https://www.tiktok.com/t/ZTabc123'],
        ['tiktok.com/@user/video/123', 'tiktok https://www.tiktok.com/@user/video/123'],
        ['https://m.tiktok.com/@user/video/123', 'tiktok https://www.tiktok.com/@user/video/123'],
        ['https://www.instagram.com/reel/C-abc123/?igsh=xyz', 'instagram https://www.instagram.com/reel/C-abc123'],
        ['https://instagram.com/reels/C-abc123/', 'instagram https://www.instagram.com/reels/C-abc123'],
        ['https://www.instagram.com/p/C_xyz/', 'instagram https://www.instagram.com/p/C_xyz'],
        ['https://www.instagram.com/some.user/reel/C-abc123/', 'instagram https://www.instagram.com/some.user/reel/C-abc123'],
        ['https://www.instagram.com/share/reel/BAabc123', 'instagram https://www.instagram.com/share/reel/BAabc123'],
        ['https://m.instagram.com/tv/C-abc/', 'instagram https://www.instagram.com/tv/C-abc'],
        ['https://youtube.com/shorts/dQw4w9WgXcQ?si=abc', 'youtube https://www.youtube.com/shorts/dQw4w9WgXcQ'],
        ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube https://www.youtube.com/shorts/dQw4w9WgXcQ'],
    ])('detects %s', (input, expected) => {
        expect(urls(`look: ${input} lol`)).toEqual([expected]);
    });

    test('finds several links in order and removes duplicates', () => {
        const text = [
            'https://www.youtube.com/shorts/dQw4w9WgXcQ',
            'https://www.tiktok.com/@a/video/1',
            'https://www.youtube.com/shorts/dQw4w9WgXcQ?si=dup',
        ].join('\n');
        expect(urls(text)).toEqual([
            'youtube https://www.youtube.com/shorts/dQw4w9WgXcQ',
            'tiktok https://www.tiktok.com/@a/video/1',
        ]);
    });

    test('reads hidden hyperlinks from entities', () => {
        expect(urls('click here', [{ type: 'text_link', url: 'https://www.instagram.com/reel/abc/' }])).toEqual([
            'instagram https://www.instagram.com/reel/abc',
        ]);
    });

    test('caps the number of links per message', () => {
        const text = Array.from({ length: 10 }, (_, i) => `https://www.tiktok.com/@a/video/${i}`).join(' ');
        expect(extractLinks(text)).toHaveLength(MAX_LINKS_PER_MESSAGE);
    });
});
