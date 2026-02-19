# Gemini Mobile API - Production Dockerfile
# Builds the mobile-api package with gemini-cli-core dependency

FROM node:20-slim AS builder

WORKDIR /app

# Copy root workspace files
COPY package*.json ./
COPY tsconfig.json ./

# Copy package manifests for workspace resolution
COPY packages/core/package*.json ./packages/core/
COPY packages/mobile-api/package*.json ./packages/mobile-api/

# Install dependencies
RUN npm ci --workspace=packages/core --workspace=packages/mobile-api

# Copy source code
COPY packages/core ./packages/core
COPY packages/mobile-api ./packages/mobile-api

# Build core first (mobile-api depends on it)
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/mobile-api

# --- Production runtime ---
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts and node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/mobile-api/dist ./packages/mobile-api/dist
COPY --from=builder /app/packages/mobile-api/package.json ./packages/mobile-api/
COPY --from=builder /app/package.json ./

# Create non-root user
RUN groupadd -r gemini && useradd -r -g gemini -m gemini
USER gemini

# Create gemini config directory
RUN mkdir -p /home/gemini/.gemini

ENV NODE_ENV=production
ENV PORT=8443

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:8443/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "packages/mobile-api/dist/src/server.js"]
