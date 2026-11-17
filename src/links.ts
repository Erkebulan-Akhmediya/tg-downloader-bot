export type Platform = 'tiktok' | 'instagram' | 'youtube';

export interface MediaLink {
    platform: Platform;
    /** Normalized https URL without query string. */
    url: string;
}

/** Hard cap so a single message full of links can't flood the queue. */
export const MAX_LINKS_PER_MESSAGE = 5;

// Scheme is optional so "tiktok.com/@user/video/123" also works.
const PATTERNS: Array<[Platform, RegExp]> = [
    [
        'tiktok',
        /(?:https?:\/\/)?(?:(?:vm|vt)\.tiktok\.com\/[\w-]+|(?:(?:www|m)\.)?tiktok\.com\/(?:@[\w.-]+\/(?:video|photo)\/\d+|t\/[\w-]+))/gi,
    ],
    [
        'instagram',
        /(?:https?:\/\/)?(?:(?:www|m)\.)?instagram\.com\/(?:share\/(?:reels?\/|p\/)?[\w-]+|(?:[\w.]+\/)?(?:reels?|p|tv)\/[\w-]+)/gi,
    ],
    [
        'youtube',
        /(?:https?:\/\/)?(?:(?:www|m)\.)?youtube\.com\/shorts\/[\w-]{11}/gi,
    ],
];

const CANONICAL_HOSTS: Record<string, string> = {
    'tiktok.com': 'www.tiktok.com',
    'm.tiktok.com': 'www.tiktok.com',
    'instagram.com': 'www.instagram.com',
    'm.instagram.com': 'www.instagram.com',
    'youtube.com': 'www.youtube.com',
    'm.youtube.com': 'www.youtube.com',
};

const normalize = (raw: string): string | null => {
    try {
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        url.protocol = 'https:';
        url.hostname = CANONICAL_HOSTS[url.hostname.toLowerCase()] ?? url.hostname.toLowerCase();
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
};

export const findLinksInString = (text: string): MediaLink[] => {
    const found: Array<MediaLink & { index: number }> = [];
    for (const [platform, pattern] of PATTERNS) {
        for (const match of text.matchAll(pattern)) {
            const url = normalize(match[0]);
            if (url) found.push({ platform, url, index: match.index ?? 0 });
        }
    }
    // Keep the order in which links appear in the message.
    return found.sort((a, b) => a.index - b.index).map(({ platform, url }) => ({ platform, url }));
};

interface EntityLike {
    type: string;
    url?: string;
}

/**
 * Extracts supported links from a message text and its entities
 * (entities cover hyperlinks whose URL is hidden behind text).
 */
export const extractLinks = (text: string, entities: readonly EntityLike[] = []): MediaLink[] => {
    const hidden = entities
        .filter((e) => e.type === 'text_link' && e.url)
        .map((e) => e.url as string);

    const seen = new Set<string>();
    const result: MediaLink[] = [];
    for (const link of [text, ...hidden].flatMap(findLinksInString)) {
        if (seen.has(link.url)) continue;
        seen.add(link.url);
        result.push(link);
        if (result.length >= MAX_LINKS_PER_MESSAGE) break;
    }
    return result;
};
