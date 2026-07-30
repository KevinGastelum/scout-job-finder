# Pinned by digest so a rebuild six months from now produces the same base, not whatever
# `1.3-alpine` has drifted to.
FROM oven/bun:1.3-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY packages/ packages/
RUN bun run web:build

FROM oven/bun:1.3-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime
WORKDIR /app

# The image carries no `claude` CLI on purpose. The rubric stage is the only caller, it
# authenticates against the operator's own subscription, and there is no way to give a pod
# that session without copying a credential into it. SCOUT_RUBRIC_BUDGET=0 is what keeps the
# scan honest here: it fetches and filters, and stops before the stage it cannot perform.
ENV NODE_ENV=production \
    SCOUT_HOST=0.0.0.0 \
    SCOUT_PORT=8787 \
    SCOUT_DB=/data/scout.db \
    SCOUT_RUBRIC_BUDGET=0

COPY --from=deps /app/node_modules node_modules/
COPY --from=build /app/packages/web/dist packages/web/dist/
COPY package.json tsconfig.json ./
COPY packages/core packages/core/
COPY packages/pipeline packages/pipeline/
COPY packages/server packages/server/
COPY scripts/ scripts/

# `bun` in the base image is uid 1000 and owns nothing under /data; the chart mounts the volume
# with an fsGroup so the writable surface is exactly the database directory.
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun --eval "const r = await fetch('http://127.0.0.1:' + (process.env.SCOUT_PORT ?? '8787') + '/api/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "run", "packages/server/src/index.ts"]
