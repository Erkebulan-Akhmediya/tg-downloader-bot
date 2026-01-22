# ---------- Build stage ----------
FROM node:24.13.0 AS builder

WORKDIR /app

# Copy dependency files first (better layer caching)
COPY package*.json ./

# Install dependencies exactly from package-lock.json
RUN npm ci

# Copy the rest of the project
COPY . .

# Build the project (creates dist/)
RUN npm run build


# ---------- Production stage ----------
FROM node:24.13.0-slim

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy only necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# No EXPOSE because your bot does not listen on HTTP ports

# Start the application
CMD ["npm", "run", "start"]
