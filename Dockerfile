# ─────────────────────────────────────────────
# Stage 1 — Builder: compile TypeScript → JS
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDependencies for tsc)
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─────────────────────────────────────────────
# Stage 2 — Production: lean runtime image
# ─────────────────────────────────────────────
FROM node:20-alpine AS production

# Install curl (healthcheck) + git (for sandbox clone commands)
RUN apk add --no-cache curl git

WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy static frontend files (served by oauth-server.ts)
# oauth-server uses: path.resolve(__dirname, '../../public')
# __dirname at runtime = /app/dist/auth → ../../public = /app/public ✓
COPY public ./public

# Copy the DNS preload script — REQUIRED for MongoDB Atlas SRV resolution
# Used in CMD as: node --require ./dns-preload.js dist/index.js
COPY dns-preload.js ./dns-preload.js

# Create all writable runtime directories:
#   auth/baileys_auth  — WhatsApp Baileys auth state (mounted as Docker volume in prod)
#   data/memory        — SQLite memory DB (mounted as Docker volume in prod)
#   data/tokens        — Per-user Google OAuth token JSON files (mounted as Docker volume)
#   logs               — PM2 / app logs
RUN mkdir -p auth/baileys_auth data/memory data/tokens logs \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Health check — poll the root HTTP endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# IMPORTANT: --require dns-preload.js MUST come before dist/index.js
# Without it, MongoDB Atlas SRV lookups fail on startup (DNS resolution race condition)
CMD ["node", "--require", "./dns-preload.js", "dist/index.js"]
