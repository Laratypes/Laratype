# Laratype Contributing Guide

Thank you for considering contributing to Laratype! This guide covers setup, commands and the branch and PR rules for human contributors. AI coding agents follow [AGENTS.md](AGENTS.md), which holds the same commands plus the agent-only rules.

`master` holds the v1 redesign, which is in development (tracking: [#83](https://github.com/Laratypes/Laratype/issues/83)). The npm release is 0.5.4.

## Where things are decided

- **Tasks and their Done-when** live in GitHub issues. v1 issues carry an ID in the title (`[C3]`, `[D1]`, `[B13]`, ...), labels (`v1`, `area: *`, priority, size) and a milestone, and are tracked in [#83](https://github.com/Laratypes/Laratype/issues/83). Respect an issue's "Depends on".
- **The v1 API** is specified in `docs/v1/<area>.md`. Before starting an issue, read the spec section it links to; [docs/v1/README.md](docs/v1/README.md) explains the format and [docs/v1/overview.md](docs/v1/overview.md) indexes the areas. If the code you need contradicts the spec, or the spec has a gap, ask on the issue or open a new one.
- **Code rules** (`import type`, TypeScript >= 5.4, decorator settings, package boundaries) are in [AGENTS.md](AGENTS.md#code-rules) and apply to everyone.

## Setup

You need Node 20.17 (see [`.node-version`](.node-version)) and [bun](https://bun.com/docs/installation).

1. Fork the repository on GitHub and clone your fork:

   ```bash
   git clone https://github.com/<your-user>/Laratype.git
   cd Laratype
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

   Run `bun install` in every new clone or git worktree; there is no setup hook.

3. Build all packages to check your setup:

   ```bash
   bun run build
   ```

The repo is a bun workspace monorepo (`packages/*`, `examples/*`). `examples/basic` is the example app. Inside the repo, `@laratype/*` resolves to `packages/*/src`.

## Commands

These match [AGENTS.md](AGENTS.md#commands).

| What | Command |
|---|---|
| Build all packages | `bun run build` |
| Declarations | `bun run build:type` |
| Contract tests | `bunx vitest run packages/contract` |
| CI smoke set | `bunx vitest run packages/contract packages/core packages/client` |
| Full suite | `bun run test --run`. `packages/http/__tests__/Request.test.ts` already fails on `master` (`ControllerMock.prototype.__invoke is not a function`); leave it alone unless that is your task. |
| Dist check | `bun run build && bun run check:dist` (lands with B13 #193) |
| DI transform tests | `CI=true bun run test:di` (lands with T3 #199). `CI=true` makes a missing snapshot fail instead of being written. |

If you change `docs/v1`, also run `bunx vitest run docs/v1/examples`. It type-checks the spec examples.

CI (`.github/workflows/ci.yml`) runs the build, the declarations and the smoke set on every PR, whatever its base, and on push to `master`.

## Branches and commits

- **Branch:** `<type>/<id>-<slug>`, with type one of `feat | fix | refactor | perf | spike | test | docs | chore | build | ci`, e.g. `feat/c3-standard-schema-adapter`.
- **Commit:** `<type>(<area>): <summary>`, with LF line endings (see [Line endings on Windows](#line-endings-on-windows)).
- Don't bump package versions; release PRs do that.

## Pull requests

- Fill in every section of [`.github/pull_request_template.md`](.github/pull_request_template.md). Its header lists the allowed types and areas.
- **Title:** `<type>(<area>): <ID> <summary>`, e.g. `feat(contract): C3 Standard Schema adapter`.
- **Labels and milestone:** copy them from the issue, without the priority or size labels.
- **Closes or Refs:** write `Closes #N` only when every Done-when item of the issue is checked. Otherwise write `Refs #N` and list what remains.
- **Spike PRs** stay draft and are never merged.
- New public API gets runtime tests and type tests.
- A PR that changes a public API updates its `docs/v1/<area>.md` section in the same PR.
- The maintainer merges with a merge commit and deletes the branch.

### Stacked PRs

When your work needs an unmerged PR, branch from that PR's branch and open your PR with it as the base. Start the PR body with a "Stacked PR" note naming the base PR and the commits to review.

After the parent PR merges:

1. If the parent branch was deleted, GitHub retargets your PR to `master`. If it was not, retarget it: `gh pr edit <N> --base master`.
2. A retarget is an `edited` event, so CI does not run. Wait until `refs/pull/<N>/merge` is rebuilt on the new `master`: `git fetch origin refs/pull/<N>/merge && git log -1 --format=%P FETCH_HEAD` must print the new `master` SHA first.
3. Close and reopen the PR to trigger CI. In the run's checkout step, the line `HEAD is now at ... Merge <head> into <base>` must name the new `master`; if it names the old base, close and reopen again.

## Line endings on Windows

The repo has no `.gitattributes` yet ([#189](https://github.com/Laratypes/Laratype/issues/189)). With `core.autocrlf=true`, files that git rewrites (checkout, rebase) get CRLF, and the sauf DI snapshot tests fail with whitespace-only diffs.

- To fix a working copy, delete the affected files and check them out again: `git -c core.autocrlf=false checkout HEAD -- <paths>`.
- Before pushing, check that committed files are LF: `git show HEAD:<file> | tr -cd '\r' | wc -c` prints `0`.

## Security

- **Review `.github/` changes.** Workflows run with the repo's secrets, and a malicious workflow was pushed to this repo in 2026-10. Before you base work on someone else's branch, or review a PR, read every `.github/` change in its diff.
- **Never commit secrets** (tokens, `.env` values), and never paste them into issues, PRs or logs.
- Don't add workflows that use secrets, or trigger `workflow_dispatch` runs, without the maintainer's approval.
