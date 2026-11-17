# ---------- Build stage ----------
FROM node:24.13.0 AS builder

WORKDIR /app

# Copy dependency files first (better layer caching)
COPY package*.json ./
RUN npm ci

# Build the project (creates dist/), then drop dev dependencies
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev


# ---------- Production stage ----------
FROM node:24.13.0-slim

WORKDIR /app

# python3 is required by yt-dlp; node (already in the image) is used by yt-dlp
# as the JavaScript runtime for YouTube.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# yt-dlp is baked into the image. Rebuild the image to update it.
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp /usr/local/bin/yt-dlp

ENV NODE_ENV=production \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    NODE_OPTIONS=--max-old-space-size=128

# Copy only what is needed at runtime
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Run as an unprivileged user; the bot never writes to disk
USER node

# No EXPOSE: the bot uses long polling and does not listen on any port.
# Run node directly (not via npm) so it receives SIGTERM for a graceful stop.
CMD ["node", "dist/index.js"]
