# ─────────────────────────────────────────────
# Stage 1 — Builder: install deps + compile TS
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install ALL dependencies (devDeps needed for tsc)
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript → JS
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune devDependencies IN the builder — faster than re-running npm ci in prod
RUN npm prune --omit=dev && npm cache clean --force

# ─────────────────────────────────────────────
# Stage 2 — Production: lean runtime image
# ─────────────────────────────────────────────
FROM node:20-alpine AS production

# Install curl (healthcheck) + git
RUN apk add --no-cache curl git

WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy package.json (needed for node module resolution)
COPY package.json ./

# Copy pruned node_modules from builder (NO second npm ci needed!)
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy static frontend files
COPY public ./public

# Copy the DNS preload script — REQUIRED for MongoDB Atlas SRV resolution
COPY dns-preload.js ./dns-preload.js

# Create all writable runtime directories
RUN mkdir -p auth/baileys_auth data/memory data/tokens logs \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Health check — poll the root HTTP endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# IMPORTANT: --require dns-preload.js MUST come before dist/index.js
CMD ["node", "--require", "./dns-preload.js", "dist/index.js"]
