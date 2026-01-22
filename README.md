# tg-downloader

This project is a **Telegram Bot** designed to download videos from **TikTok** and **Instagram Reels**.  
It allows users to send a link to a TikTok video or Instagram Reel, and the bot responds with the downloaded video file.

## Features

-   **TikTok & Instagram Reels Support**: Automatically detects links from these platforms.
-   **Video Downloading**: Uses `yt-dlp` (via `yt-dlp-wrap`) to fetch videos.
-   **Automatic Binary Management**: Checks for and downloads the `yt-dlp` binary if it's missing.
-   **Seamless Integration**: Sends the video directly back to the chat.

## Commands

These commands are defined in `package.json`:

-   `npm run build`: Compiles the TypeScript code to JavaScript using `tsc`.
-   `npm start`: Starts the compiled application (`node dist/index.js`).
-   `npm run dev`: Starts the application in development mode using `nodemon src/index.ts`.
-   `npm test`: Runs the test suite using `jest`.

## Setup

1.  Clone the repository.
2.  Install dependencies: `npm install`.
3.  Create a `.env` file and add your `BOT_TOKEN`.
4.  Run the bot: `npm run dev`.
