# tg-downloader

A **Telegram bot** that downloads videos from **TikTok**, **Instagram Reels** and **YouTube Shorts**.
Send it a link (in a private chat or in a group) and it replies to that message with the video.

## Features

-   **TikTok, Instagram and YouTube Shorts**: full links, short links (`vm.tiktok.com`, `vt.tiktok.com`,
    `tiktok.com/t/...`, `instagram.com/share/...`) and hidden hyperlinks are all detected.
-   **Replies to the original message**: the video is sent as a reply to the message containing the link,
    which keeps things readable in group chats (forum topics are supported too).
-   **Photo posts as one album**: TikTok photo slideshows and Instagram carousels are sent back as a single
    media group (album), also as a reply. Telegram allows up to 10 items per album, so bigger posts are
    split into several albums.
-   **Skips the backlog after downtime**: when the bot comes back online it ignores messages older than
    5 minutes instead of replying to everything it missed.
-   **Stores nothing**: media is streamed from `yt-dlp` / the CDN straight to Telegram. No files are written
    to disk, no database, no cache, no full-file buffering in memory.
-   **Low memory usage**: downloads run through a small bounded queue (2 at a time by default), so memory
    stays flat even when many links arrive at once. The bot idles at roughly 25-30 MB of RAM.

## How it works

1. Links are extracted from the message; messages older than `MAX_MESSAGE_AGE_SECONDS` are dropped.
2. `yt-dlp -J` inspects the link once (no download yet).
    - Video: `yt-dlp` re-uses that info (`--load-info-json -`) and writes the video to stdout, which is
      piped directly into the Telegram upload.
    - Photos: image URLs are taken from the Instagram post info, or from the TikTok page for slideshows
      (with [tikwm.com](https://www.tikwm.com) as a fallback when TikTok blocks the request), and streamed
      into a single `sendMediaGroup` call.
3. If anything fails, the bot replies `Не удалось скачать видео.` to the message.

## Run with Docker (recommended)

The image contains Node.js, Python and the latest `yt-dlp`, so nothing else needs to be installed.

1.  Create a `.env` file with your bot token (get one from [@BotFather](https://t.me/BotFather)):

    ```bash
    cp .env.example .env
    # then edit .env and set BOT_TOKEN=...
    ```

2.  Build and start the bot with Docker Compose:

    ```bash
    docker compose up -d --build
    ```

3.  Check the logs:

    ```bash
    docker compose logs -f
    ```

To stop it run `docker compose down`.

The provided `docker-compose.yml` already:

-   restarts the container automatically (`restart: unless-stopped`) after crashes, Docker daemon restarts
    and server reboots, unless you stopped it yourself. The bot exits on fatal errors so Docker can restart it;
-   runs with a read-only filesystem, no volumes and a small in-memory `/tmp`, so nothing is persisted;
-   uses an init process (`init: true`) to forward signals and clean up `yt-dlp` child processes;
-   limits memory to 512 MB and rotates logs (3 × 10 MB).

### Without Docker Compose

```bash
docker build -t tg-downloader-bot .
```

```bash
docker run -d --name tg-downloader-bot --env-file .env --restart unless-stopped --init --read-only --tmpfs /tmp:size=16m --memory 512m tg-downloader-bot
```

### Updating yt-dlp

TikTok, Instagram and YouTube change often, and `yt-dlp` is updated to keep up. `yt-dlp` is baked into the
image at build time, so if downloads start failing, rebuild the image to get the newest version:

```bash
docker compose build --no-cache && docker compose up -d
```

## Run locally (development)

Requirements: Node.js 22+ and Python 3.10+ (for `yt-dlp`).

1.  Install dependencies: `npm install`.
2.  Create a `.env` file and set `BOT_TOKEN` (see `.env.example`).
3.  Run the bot: `npm run dev`.

If `yt-dlp` is not on your `PATH` (and `YTDLP_PATH` is not set), the latest release is downloaded into the
project folder on first start.

### Commands

-   `npm run build`: compiles the TypeScript code to `dist/`.
-   `npm start`: starts the compiled bot (`node dist/index.js`).
-   `npm run dev`: starts the bot in development mode with `nodemon`.
-   `npm test`: runs the test suite with `jest` (includes an end-to-end test against a fake Telegram API).

## Configuration

All settings are environment variables (put them in `.env`):

| Variable                  | Default | Description                                                                      |
| ------------------------- | ------- | -------------------------------------------------------------------------------- |
| `BOT_TOKEN`               | -       | **Required.** Bot token from @BotFather.                                         |
| `MAX_MESSAGE_AGE_SECONDS` | `300`   | Messages older than this are ignored (e.g. ones sent while the bot was offline). |
| `MAX_CONCURRENT_JOBS`     | `2`     | How many links are downloaded at the same time.                                  |
| `MAX_QUEUE_SIZE`          | `50`    | How many links can wait in the queue; extra links are dropped.                   |
| `TIKTOK_PHOTO_FALLBACK`   | `true`  | Set to `false` to never use tikwm.com for TikTok photo posts.                    |
| `TELEGRAM_API_ROOT`       | -       | Custom Bot API server, e.g. a self-hosted `telegram-bot-api`.                    |
| `YTDLP_PATH`              | -       | Path to the `yt-dlp` binary (set automatically in Docker).                       |

## Using the bot in group chats

Add the bot to the group. By default Telegram bots only see commands in groups, so to let it see links
either make the bot a group admin, or disable privacy mode in @BotFather (`/setprivacy` → your bot →
`Disable`) and then remove and re-add the bot to the group.

## Limitations

-   Telegram bots can upload files up to 50 MB; the bot picks a format under that size when the site
    reports sizes.
-   Private posts, age-restricted videos and posts that require login can't be downloaded.
-   Sites sometimes rate-limit or block server IP addresses; updating `yt-dlp` (see above) fixes most issues.
