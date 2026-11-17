import { spawn, spawnSync, ChildProcess } from 'child_process';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import fs from 'fs';
import path from 'path';

const BINARY_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const DOWNLOAD_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${BINARY_NAME}`;

/** Telegram bots can upload files up to 50 MB via the public Bot API. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const INFO_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const STDERR_LIMIT = 4096;

/**
 * Best single file that already contains audio + video (no merging needed, so it
 * can be piped straight to Telegram), preferring plain HTTP(S) and files that fit
 * the upload limit. `ba` is the last resort so TikTok slideshows (audio only)
 * still return info instead of failing.
 */
const FORMAT =
    'b[protocol^=http][filesize<50M]/b[protocol^=http][filesize_approx<50M]/b[protocol^=http]/b/ba';
// Prefer H.264 (plays everywhere in Telegram), <=1080p, mp4.
const FORMAT_SORT = 'vcodec:h264,res:1080,ext:mp4:m4a';

const BASE_ARGS = [
    '--ignore-config',
    '--no-cache-dir', // do not persist anything on disk
    '--no-playlist',
    '--no-progress',
    '--no-warnings',
    '--socket-timeout', '30',
    // YouTube needs a JS runtime; node is always available where the bot runs.
    '--js-runtimes', 'node',
    '-f', FORMAT,
    '-S', FORMAT_SORT,
];

let binaryPath: string | null = null;
const children = new Set<ChildProcess>();

const runsOk = (bin: string): boolean => {
    try {
        return spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 30_000 }).status === 0;
    } catch {
        return false;
    }
};

/**
 * Locates yt-dlp: $YTDLP_PATH, ./yt-dlp, or yt-dlp on $PATH. For local development
 * it downloads the latest release into the working directory if none is found.
 */
export const ensureBinary = async (): Promise<string> => {
    if (binaryPath) return binaryPath;

    const local = path.join(process.cwd(), BINARY_NAME);
    const candidates = [process.env.YTDLP_PATH, local, 'yt-dlp'].filter(Boolean) as string[];
    for (const candidate of candidates) {
        if (runsOk(candidate)) {
            binaryPath = candidate;
            return candidate;
        }
    }
    if (process.env.YTDLP_PATH) {
        throw new Error(`YTDLP_PATH=${process.env.YTDLP_PATH} is not a working yt-dlp binary`);
    }

    console.log('yt-dlp not found, downloading the latest release...');
    const res = await fetch(DOWNLOAD_URL);
    if (!res.ok || !res.body) throw new Error(`Failed to download yt-dlp: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(local, { mode: 0o755 }));
    console.log(`yt-dlp downloaded to ${local}`);
    binaryPath = local;
    return local;
};

const start = (args: string[]): ChildProcess => {
    if (!binaryPath) throw new Error('yt-dlp is not initialized, call ensureBinary() first');
    const child = spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    child.once('close', () => children.delete(child));
    return child;
};

const collectStderr = (child: ChildProcess): (() => string) => {
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });
    return () => stderr.trim();
};

export class YtDlpError extends Error {}

/** Runs `yt-dlp -J` and returns the parsed info dict. */
export const getInfo = (url: string, extraArgs: string[] = []): Promise<any> =>
    new Promise((resolve, reject) => {
        const child = start([...BASE_ARGS, ...extraArgs, '-J', '--', url]);
        const stderr = collectStderr(child);
        const chunks: Buffer[] = [];
        child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
        child.stdin?.end();

        const timer = setTimeout(() => child.kill('SIGKILL'), INFO_TIMEOUT_MS);
        child.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            if (code !== 0) {
                return reject(new YtDlpError(`yt-dlp exited with ${code ?? signal}: ${stderr()}`));
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (err) {
                reject(new YtDlpError(`yt-dlp returned invalid JSON: ${(err as Error).message}`));
            }
        });
    });

export interface DownloadHandle {
    stream: Readable;
    /** Stops the download (no-op if it already finished). */
    cancel: () => void;
}

/**
 * Downloads the media described by an info dict (from getInfo) and streams it via
 * stdout, so the file is never written to disk nor fully buffered in memory.
 * Re-using the info dict avoids a second extraction request to the site.
 */
export const streamFromInfo = (info: unknown): DownloadHandle => {
    const child = start([...BASE_ARGS, '--load-info-json', '-', '-o', '-']);
    const stderr = collectStderr(child);
    // stdout is piped through a PassThrough that only ends once yt-dlp exits successfully:
    // a download that fails midway must error the upload instead of sending a truncated file.
    const stream = new PassThrough();
    stream.on('error', () => undefined); // errors are surfaced to the uploader separately
    child.stdout?.pipe(stream, { end: false });
    let finished = false;

    const timer = setTimeout(() => child.kill('SIGKILL'), DOWNLOAD_TIMEOUT_MS);
    child.once('error', (err) => stream.destroy(err));
    child.once('close', (code, signal) => {
        clearTimeout(timer);
        finished = true;
        if (code === 0) stream.end();
        else if (!stream.destroyed) {
            stream.destroy(new YtDlpError(`yt-dlp exited with ${code ?? signal}: ${stderr()}`));
        }
    });

    child.stdin?.on('error', () => undefined); // process may exit before reading stdin
    child.stdin?.end(JSON.stringify(info));

    return {
        stream,
        cancel: () => {
            if (!finished) child.kill('SIGKILL');
        },
    };
};

/** Kills running yt-dlp processes (used on shutdown). */
export const killAll = (): void => {
    for (const child of children) child.kill('SIGKILL');
};

/** Visible for tests. */
export const __resetForTests = (): void => {
    binaryPath = null;
};
