# Base image pinned to minor. Review quarterly or on security advisory. Last reviewed: 2026-04.
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy root workspace files for dependency resolution
COPY package.json bun.lock ./
COPY apps/dashboard/package.json apps/dashboard/

RUN bun install --frozen-lockfile

# Copy dashboard source
COPY apps/dashboard/ apps/dashboard/

WORKDIR /app/apps/dashboard
RUN NEXT_PUBLIC_API_URL="__NEXT_PUBLIC_API_URL_PLACEHOLDER__" bun run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./.next/static
COPY --from=builder /app/apps/dashboard/public ./public
COPY apps/dashboard/scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

ENV NEXT_PUBLIC_API_URL=""
ENV PORT=3001

EXPOSE ${PORT}
ENTRYPOINT ["./entrypoint.sh"]
