# Phase-1 runtime benchmark (#353). Run it here or in .github/workflows/bench.yml, never on a dev machine:
# it starts real app servers and autocannon. See bench/README.md.
#
# Base images are pinned to a tag plus its manifest-list digest, taken on 2026-11-25:
#   node:20.17.0-bookworm-slim  published 2024-09-27  sha256:2394e403d45a644e41ac2a15b6f843a7d4a99ad24be48c27982c5fdc61a1ef17
#   oven/bun:1.3.14             published 2026-05-13  sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

# Bun 1.3.14 is the version .github/setup-bun pins (Bun 1.4 changed CJS interop, #241).
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

FROM node:20.17.0-bookworm-slim@sha256:2394e403d45a644e41ac2a15b6f843a7d4a99ad24be48c27982c5fdc61a1ef17

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# The build context is the repo root: `docker build -f bench/Dockerfile .`. `.dockerignore` keeps .git,
# node_modules, the built dists and bench/out out of the image.
COPY . .

RUN bun --version && node --version
RUN bun install --ignore-scripts --frozen-lockfile
RUN bun run build

# The runner writes the JSON + Markdown report here. Mount a host directory over /out; the workflow uploads it.
ENV BENCH_OUT=/out

# `bun run bench` is the root script (`bun bench/run.mjs`). NODE_ENV=production and 127.0.0.1 binding are set per
# measured child by the runner, so they are not set here.
CMD ["bun", "run", "bench"]
