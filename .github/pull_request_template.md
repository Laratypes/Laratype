<!--
Branch: <type>/<id>-<slug>   e.g. spike/s3-constructor-di-transform, feat/c1-define-contract, fix/auth-config-undefined
  The branch prefix IS the type of change; the PR title uses the same type.
  type: feat | fix | refactor | perf | spike | test | docs | chore | build | ci
PR title: <type>(<area>): <ID> <summary>
  area: contract | di | http | client | build | auth | typegen | database | cli | examples | docs
  e.g. spike(di): S3 constructor DI transform  ·  feat(contract): C1 defineContract core
PR labels + milestone: copy from the issue (`v1`, `area: *`, `spike` if applicable) + the issue's milestone.
  Do NOT add priority or size labels to PRs.
Delete sections marked (if applicable) when they don't apply. Keep the rest; write "N/A" if empty.
-->

## Summary

<!-- 1–3 sentences: what this PR does and why. -->

## Linked issues

<!--
Closes vs Refs:
- Implementation PR: `Closes #N (ID)` only when every "Done when" item below is checked; otherwise `Refs #N (ID)` + list what remains.
- Spike PR: always `Refs #N (ID)`, never Closes. Spike PRs stay draft as reference and are not merged;
  the user closes the spike issue after the decision comment is posted.
-->

- Refs #<!-- N --> (<!-- ID -->)
- Milestone: <!-- e.g. v1 · M0 — Design spikes & scaffolding -->
- Tracking: #83
- Depends on: <!-- from the issue's "Depends on", e.g. #87 (S4) -->
- Unblocks: <!-- e.g. #101 (T1) -->

## Done when (copied from issue)

<!-- Paste the issue's "Done when" items. Reviewers check the PR against this list. -->

- [ ]

**Remaining** (only with `Refs`): <!-- what is left and where it will be done -->

**Breaking change:** No <!-- or "Yes" + fill in *Breaking changes* below -->

## Changes

<!-- Bullet list of what changed, grouped by package. Point reviewers to the files that matter. -->

-

## Spike result (if applicable)

- **Verdict:** GO / NO-GO / GO with conditions
- **Conditions:**
  1.
- **Findings:** <!-- link to FINDINGS.md on this branch -->
- **Carry over** (target issue with ID, so items can be copied over directly):
  - [ ] #<!-- N --> (<!-- ID -->): <!-- open decision -->

## How verified

<!-- Commands actually run and their result. Paste short output; link CI. "Not run" is allowed but say why. -->

| Check | Command | Result |
|---|---|---|
| Build | `bun run build` | |
| Types | `bun run build:type` | |
| Tests | `bun run test` | |
| Example app | `examples/basic`: <!-- what you ran --> | |
| Other | | |

## Breaking changes / migration (if applicable)

<!-- What breaks for users of @laratype/* and how to migrate (config, imports, decorators, CLI). -->

## Risks & rollback

<!-- What could go wrong, what is not covered, how to revert. -->

## Checklist

- [ ] Branch is based on an up-to-date `origin/master`
- [ ] Branch name, title, labels and milestone follow the rules at the top of this template
- [ ] Type-only imports use `import type` (`verbatimModuleSyntax`)
- [ ] No generated or local files committed (`node_modules`, `out/`, `dist/`, junctions)
- [ ] Package versions not bumped (done in the release PR)
- [ ] Public API / CLI changes documented (README or docs)
- [ ] Tests added or updated, or the reason they're not needed is given above

