# Phase-1 runtime benchmark (#353). Run it here or in .github/workflows/bench.yml, never on a dev machine:
# it starts real app servers and autocannon. See bench/README.md.
#
# Base images are pinned to a tag plus its manifest-list digest:
#   node:22.23.5-bookworm-slim  published 2026-11-24  sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb
#   oven/bun:1.3.14             published 2026-05-13  sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
#
# The Node tag must match EXPECTED_NODE_VERSION in bench/lib/node.mjs (the runner checks `node --version`).

# Bun 1.3.14 is the version .github/setup-bun pins (Bun 1.4 changed CJS interop, #241).
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

FROM node:22.23.5-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# The build context is the repo root: `docker build -f bench/Dockerfile .`. `.dockerignore` keeps .git,
# node_modules, the built dists and bench/out out of the image.
COPY . .

RUN bun --version && node --version
RUN bun install --ignore-scripts --frozen-lockfile
RUN bun run build

# Container-only guard: bench/run.mjs refuses to start unless this marker is set (bench/lib/container.mjs). There is no
# override, so a host `bun run bench` or `bun run bench:smoke` prints one refusal line and exits 1.
ENV LARATYPE_BENCH_CONTAINER=1

# The runner writes the JSON + Markdown report here. Mount a host directory over /out; the workflow uploads it.
ENV BENCH_OUT=/out

# `bun run bench` is the root script (`bun bench/run.mjs`). NODE_ENV=production and 127.0.0.1 binding are set per
# measured child by the runner, so they are not set here.
CMD ["bun", "run", "bench"]
