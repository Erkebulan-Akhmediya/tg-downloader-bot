import YtDlpWrap from 'yt-dlp-wrap';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';

// Helper to ensure yt-dlp binary exists
const BINARY_FILENAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BINARY_PATH = path.join(process.cwd(), BINARY_FILENAME);

// Initialize wrapper
// Check if binary exists, if not, it should be downloaded.
// For now, allow YtDlpWrap to manage it or assume it's there?
// The plan said we'd use yt-dlp-wrap to automatic download.
const ytDlpWrap = new YtDlpWrap(BINARY_PATH);

export const ensureBinary = async (): Promise<void> => {
    if (!fs.existsSync(BINARY_PATH)) {
        console.log('Downloading yt-dlp binary...');
        await YtDlpWrap.downloadFromGithub(BINARY_PATH);
        console.log('yt-dlp binary downloaded.');
    }
}

export const downloadStream = (url: string): Readable => {
    // execStream returns a Readable stream of the stdout
    // arguments: url and options
    // -o - to stdout is default if no output specified? No, usually needs -o -
    // But yt-dlp-wrap execStream captures stdout.

    // We want to verify valid tiktok/reel link before? No, the caller does that.

    return ytDlpWrap.execStream([
        url,
        '-f', 'best', // best quality
        '-o', '-' // output to stdout
    ]);
};

export const getVideoInfo = async (url: string): Promise<any> => {
    return await ytDlpWrap.getVideoInfo(url);
}
