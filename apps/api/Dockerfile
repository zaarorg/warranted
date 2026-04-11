# Base image pinned to minor. Review quarterly or on security advisory. Last reviewed: 2026-04.
FROM oven/bun:1.3

WORKDIR /app

# Copy workspace package files for dependency install
COPY package.json bun.lock ./
COPY packages/rules-engine/package.json packages/rules-engine/
COPY apps/api/package.json apps/api/

RUN bun install --frozen-lockfile

# Copy source
COPY packages/rules-engine/ packages/rules-engine/
COPY apps/api/ apps/api/
COPY drizzle/ drizzle/

# Copy startup script
COPY apps/api/scripts/start.sh .
RUN chmod +x start.sh

ENV DATABASE_URL=""
ENV PORT=3000
ENV SKIP_MIGRATE=""
ENV SKIP_SEED=""

EXPOSE ${PORT}

CMD ["./start.sh"]
