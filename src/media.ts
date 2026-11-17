import { MediaLink } from './links';
import { getInfo } from './ytdlp';

export const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const PAGE_TIMEOUT_MS = 20_000;

export interface VideoMeta {
    width?: number;
    height?: number;
    duration?: number;
}

export interface AlbumItem {
    type: 'photo' | 'video';
    url: string;
    headers?: Record<string, string>;
}

export type ResolvedMedia =
    | { kind: 'video'; info: any; meta: VideoMeta }
    | { kind: 'album'; items: AlbumItem[] };

export class UnsupportedMediaError extends Error {}

const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;

const hasVideo = (info: any): boolean =>
    Boolean(info?.url || info?.requested_formats) && info?.vcodec !== 'none';

const videoMeta = (info: any): VideoMeta => ({
    width: num(info.width),
    height: num(info.height),
    duration: num(info.duration),
});

/** Largest thumbnail of an entry - for Instagram image posts this is the photo itself. */
const bestImageUrl = (entry: any): string | undefined => {
    const thumbs: any[] = Array.isArray(entry?.thumbnails) ? entry.thumbnails : [];
    const best = thumbs
        .filter((t) => typeof t?.url === 'string')
        .reduce<any>((acc, t) => (!acc || (t.width ?? 0) >= (acc.width ?? 0) ? t : acc), undefined);
    return best?.url ?? (typeof entry?.thumbnail === 'string' ? entry.thumbnail : undefined);
};

/** Converts an Instagram carousel (yt-dlp playlist) or single post into album items. */
export const albumFromInfo = (info: any): AlbumItem[] => {
    const entries: any[] = info?._type === 'playlist' ? (info.entries ?? []) : [info];
    const items: AlbumItem[] = [];
    for (const entry of entries) {
        if (!entry) continue;
        if (hasVideo(entry) && typeof entry.url === 'string') {
            items.push({ type: 'video', url: entry.url, headers: entry.http_headers });
            continue;
        }
        const image = bestImageUrl(entry);
        if (image) items.push({ type: 'photo', url: image, headers: { Referer: 'https://www.instagram.com/' } });
    }
    return items;
};

/** Follows redirects of short links (vm.tiktok.com, instagram.com/share/...) without downloading pages. */
export const resolveRedirects = async (url: string, maxHops = 5): Promise<string> => {
    let current = url;
    for (let hop = 0; hop < maxHops; hop++) {
        const res = await fetch(current, {
            method: 'HEAD',
            redirect: 'manual',
            headers: { 'User-Agent': BROWSER_UA },
            signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        });
        const location = res.headers.get('location');
        if (res.status < 300 || res.status >= 400 || !location) return current;
        current = new URL(location, current).toString();
    }
    return current;
};

const pickImageUrl = (urls: unknown): string | undefined => {
    if (!Array.isArray(urls)) return undefined;
    const list = urls.filter((u): u is string => typeof u === 'string');
    // Telegram handles JPEG best; TikTok usually offers both jpeg and webp variants.
    return list.find((u) => /\.jpe?g(?:\?|$)/i.test(u) || /jpeg/i.test(u)) ?? list[0];
};

/** Extracts slideshow image URLs from a TikTok web page. */
export const parseTikTokImages = (html: string): string[] => {
    const match = html.match(
        /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!match) return [];
    let data: any;
    try {
        data = JSON.parse(match[1]);
    } catch {
        return [];
    }
    const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    const images: any[] = item?.imagePost?.images ?? [];
    return images
        .map((img) => pickImageUrl(img?.imageURL?.urlList) ?? pickImageUrl(img?.displayImage?.urlList))
        .filter((u): u is string => Boolean(u));
};

const fetchTikTokImagesFromPage = async (url: string): Promise<string[]> => {
    const res = await fetch(url, {
        headers: {
            'User-Agent': BROWSER_UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseTikTokImages(await res.text());
};

/**
 * Fallback for when TikTok serves a bot challenge instead of the page:
 * tikwm.com is a public TikTok API mirror that also returns slideshow images.
 * Disable with TIKTOK_PHOTO_FALLBACK=false.
 */
const fetchTikTokImagesFromTikwm = async (url: string): Promise<string[]> => {
    if (process.env.TIKTOK_PHOTO_FALLBACK === 'false') return [];
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body: any = await res.json();
    const images = body?.data?.images;
    return Array.isArray(images) ? images.filter((u: unknown): u is string => typeof u === 'string') : [];
};

export const getTikTokImages = async (url: string): Promise<string[]> => {
    const fromPage = await fetchTikTokImagesFromPage(url).catch(() => []);
    if (fromPage.length > 0) return fromPage;
    return fetchTikTokImagesFromTikwm(url).catch(() => []);
};

const tiktokAlbum = async (url: string): Promise<ResolvedMedia> => {
    const images = await getTikTokImages(url);
    if (images.length === 0) throw new UnsupportedMediaError(`No images found for ${url}`);
    return {
        kind: 'album',
        items: images.map((u) => ({ type: 'photo', url: u, headers: { Referer: 'https://www.tiktok.com/' } })),
    };
};

const resolveTikTok = async (link: MediaLink): Promise<ResolvedMedia> => {
    let url = link.url;
    const { hostname, pathname } = new URL(url);
    if (hostname !== 'www.tiktok.com' || pathname.startsWith('/t/')) {
        url = await resolveRedirects(url);
    }
    // Strip tracking params added by the redirect; yt-dlp only needs the path.
    const resolved = new URL(url);
    resolved.search = '';
    url = resolved.toString();

    if (/\/photo\/\d+/.test(resolved.pathname)) return tiktokAlbum(url);

    let info: any;
    try {
        info = await getInfo(url, ['--user-agent', BROWSER_UA]);
    } catch (err) {
        // yt-dlp fails on some slideshows; try them as photos before giving up.
        const album = await tiktokAlbum(url).catch(() => null);
        if (album) return album;
        throw err;
    }
    if (hasVideo(info)) return { kind: 'video', info, meta: videoMeta(info) };
    // Slideshows come back as audio-only "videos".
    return tiktokAlbum(url);
};

const resolveInstagram = async (link: MediaLink): Promise<ResolvedMedia> => {
    let url = link.url;
    if (new URL(url).pathname.startsWith('/share/')) url = await resolveRedirects(url);

    const info = await getInfo(url, ['--user-agent', BROWSER_UA, '--ignore-no-formats-error']);
    if (info?._type !== 'playlist' && hasVideo(info)) {
        return { kind: 'video', info, meta: videoMeta(info) };
    }
    const items = albumFromInfo(info);
    if (items.length === 0) throw new UnsupportedMediaError(`Nothing to download for ${url}`);
    return { kind: 'album', items };
};

const resolveYouTube = async (link: MediaLink): Promise<ResolvedMedia> => {
    const info = await getInfo(link.url);
    if (!hasVideo(info)) throw new UnsupportedMediaError(`No video found for ${link.url}`);
    return { kind: 'video', info, meta: videoMeta(info) };
};

export const resolveMedia = (link: MediaLink): Promise<ResolvedMedia> => {
    switch (link.platform) {
        case 'tiktok':
            return resolveTikTok(link);
        case 'instagram':
            return resolveInstagram(link);
        case 'youtube':
            return resolveYouTube(link);
    }
};
