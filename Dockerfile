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

# Install curl for health checks (wget is absent in node:alpine)
RUN apk add --no-cache curl

WORKDIR /app

# Non-root user for security — create BEFORE chown
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy static assets served by the OAuth server
# oauth-server.ts resolves: path.resolve(__dirname, '../../public')
# __dirname = /app/dist/auth  →  ../../public = /app/public  ✓
COPY public ./public

# Create writable directories for runtime data and fix ownership
# (in production these are overridden by Docker volume mounts)
RUN mkdir -p auth/baileys_auth data/memory \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Health check — use curl (available via apk above)
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "dist/index.js"]
