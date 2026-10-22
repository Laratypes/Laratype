# AGENTS.md

Guide for AI coding agents (Claude Code, Codex, Orca workers) working in this repo. Human setup is in [CONTRIBUTING.md](CONTRIBUTING.md). `CLAUDE.md` only imports this file.

## Rules that come first

- Agents never merge PRs, never push to `master`, and never force-push without the user's explicit approval for that branch. When it is approved, use `git push --force-with-lease=<branch>:<expected-old-sha>`.
- Pushing a branch, opening a PR and posting on GitHub (comments, issue edits) need approval from the user, or from the coordinator session that relays it. Until then, commit locally. A worker started by a coordinator reports through the channel its task names and leaves pushing to the coordinator.
- Read every `.github/` change in a diff before basing work on that branch. Workflows run with repo secrets, and a malicious workflow was pushed to this repo in 2026-10.
- Never run `git stash pop`, `git stash drop` or `git stash clear`. Worktrees share the stash, and it holds the user's WIP.
- Never print, commit or send secrets (tokens, `.env` values). Do not add workflows that use secrets, or trigger `workflow_dispatch` runs, without the user.

## Docs rule

**Issues are the source of truth for tasks and Done-when; `docs/v1/<area>.md` is the source of truth for the API.**

Before starting an issue, read the spec section it links to ([docs/v1/README.md](docs/v1/README.md) explains the format). If the code you need contradicts the spec, or the spec has a gap, ask or open an issue. Do not invent API.

## Repo map

Bun workspace monorepo (`packages/*`, `examples/*`). npm has 0.5.4; v1 is in progress, tracked in #83.

v1:
- `packages/contract` (`@laratype/contract`): endpoint builder, path params, capabilities and derived errors, `defineError`, Standard Schema types, the validation adapter, `defineContract`, `defineScope` and `defineApi`. Shared by the server and the FE.
- `packages/core` (`@laratype/core`): v1 DI container: tokens, `Container`, dependency metadata and the deps registry (D1, D2).
- `packages/client` (`@laratype/client`): typed FE client (CL-series), scaffold only so far.

0.5, maintained and being migrated: `laratype` (app entry, kernel), `sauf` (CLI: `sauf dev` with Vite SSR, `sauf build`), `http`, `support` (ServiceProvider v2 from D4, 0.5 helpers), `validation`, `auth`, `database`, `console`, `log`, `mail`, `i18n`, `storage`, `schedule`, `broadcast`, `ts-gen`. `examples/basic` is the example app.

Design spikes live on spike branches only (draft PRs #183 and #197); the S1/S2 decisions are in `spikes/v1/DECISIONS-S1-S2.md` there.

Boundaries:
- `@laratype/contract` stays browser-pure: no `node:*` imports, no Node globals, no runtime dependencies. Schema libraries (zod, valibot) are devDependencies only. `packages/contract/__tests__/typecheck.test.ts` compiles `src` with the DOM lib and no Node types.
- Contracts depend on the Standard Schema v1 types, never on one schema library.
- The FE imports contracts only (the `appApi` built with `defineApi`, or a contract file of the `app/api` folder tree), never `typeof routes` or any server module.
- `@laratype/*` resolves to `packages/*/src` (`tsconfig.app.json` paths, `scripts/alias` for vitest).

## Commands

Node 20.17 (`.node-version`) and bun. Run `bun install` in every new worktree; there is no setup hook.

| What | Command |
|---|---|
| Build all packages | `bun run build` |
| Declarations | `bun run build:type` |
| Contract tests | `bunx vitest run packages/contract` |
| Full suite | `bun run test --run`, the same run as `bunx vitest run` in CI: every workspace project, including the `types` project and the `docs/v1/examples` type-check. Run `bun run build` first: `sauf/__tests__/devSsr` runs the built sauf CLI and `sauf/__tests__/di/plugin` resolves `@laratype/core` from its `dist`. |

CI (`.github/workflows/ci.yml`) runs the build, the declarations, the dist and package checks and the full test suite on every PR, whatever its base, and on push to `master`.

`.github/workflows/pkg-preview.yml` publishes a [pkg.pr.new](https://pkg.pr.new) preview of every public package on PRs from branches of this repo, on push to `master` and on manual `workflow_dispatch` runs; the pkg.pr.new app comments the install links on the PR. Changes that touch only `docs/**` or root-level `*.md` files get no preview.

## Code rules

- Type-only imports use `import type`.
- TypeScript >= 5.4: public types use `NoInfer`, and the contract package declares an optional `typescript >=5.4` peer.
- Keep SWC `legacyDecorator: true` and `decoratorMetadata: true` (`packages/sauf/src/bin/warmup.ts`) and `emitDecoratorMetadata` in `tsconfig.app.json` until S5 #88 decides otherwise. TypeORM entities rely on them.
- v1 DI is constructor injection with no mandatory decorators; a sauf build transform generates the dependency metadata.
- Before writing code, check whether Hono (`packages/http`, `laratype`, `support` already depend on it) or an existing dependency covers it. If it does, use that and do not reimplement or wrap it.
- Prefer an existing library over hand-written code. When adding a dependency, prefer MIT (or similarly permissive: Apache-2.0, BSD, ISC) licenses, name the library and its license in the PR, and ask before adding a copyleft (GPL, AGPL, LGPL) one. `@laratype/contract` stays the exception: no runtime dependencies.
- Match the surrounding code: naming, quotes, comment density. New public API gets runtime tests and type tests.
- Don't bump package versions; release PRs do that.

## Workflow

**Issues.** v1 issues carry an ID in the title (`[C3]`, `[D1]`, `[B13]`, ...), labels (`v1`, `area: *`, priority, size) and a milestone, and are tracked in #83. Respect their "Depends on".

**Branches.** `<type>/<id>-<slug>`, with type one of `feat | fix | refactor | perf | spike | test | docs | chore | build | ci`, e.g. `feat/c3-standard-schema-adapter`. If your clone has a local branch named `docs`, git cannot create `docs/...` locally: use a local name without the prefix and push with `git push -u origin HEAD:docs/<id>-<slug>`.

**Commits.** `<type>(<area>): <summary>`, LF line endings (see below).

**PRs.** Follow `.github/pull_request_template.md` and fill every section. Title `<type>(<area>): <ID> <summary>`. Copy the labels and milestone from the issue, without priority or size labels. Use `Closes #N` only when every Done-when item is checked, otherwise `Refs #N`. Spike PRs stay draft and are never merged. The user merges with a merge commit and deletes the branch.

### Stacked PRs

When your work needs an unmerged PR, branch from that PR's branch and open your PR with it as the base. Start the body with a "Stacked PR" note naming the base PR and the commits to review.

After the parent merges:
1. If the parent branch was deleted, GitHub retargets your PR to `master`. If it was not, retarget it: `gh pr edit <N> --base master`.
2. A retarget is an `edited` event, so CI does not run. Wait until `refs/pull/<N>/merge` is rebuilt on the new `master`: `git fetch origin refs/pull/<N>/merge && git log -1 --format=%P FETCH_HEAD` must print the new `master` SHA first.
3. Close and reopen the PR to trigger CI. In the run's checkout step, the line `HEAD is now at ... Merge <head> into <base>` must name the new `master`; if it names the old base, close and reopen again.

Rebasing a pushed branch means a force-push, which needs the user (see the top).

### Line endings

`.gitattributes` sets `* text=auto eol=lf` (and `*.png binary`), so git checks text files out as LF on every platform, whatever `core.autocrlf` is. A clone or worktree checked out before that commit keeps CRLF copies of the files git has not rewritten since (on Windows with `core.autocrlf=true`, nearly every file), `git status` does not show them, and snapshot tests fail on them with whitespace-only diffs. Run these commands from the repo root: `git ls-files --eol | grep crlf` lists them. To fix the checkout once, commit your changes to tracked files first (don't use the stash: see the stash rule above), because `reset --hard` discards them (untracked files are kept). Then run `git rm -rq --cached . && git reset --hard HEAD`; afterwards `git ls-files --eol | grep crlf` prints nothing. Before pushing, check that committed files are LF: `git show HEAD:<file> | tr -cd '\r' | wc -c` prints `0`.

### Automated review

Kody (`kody-ai`) reviews PRs. Treat its comments like any reviewer's: verify a suggestion before applying it, and reply with the commit that fixes it. If it replaces a PR description with its own summary, restore the template body from the description's edit history.
