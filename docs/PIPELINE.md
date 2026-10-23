# Pipeline — the PR gate set

This document describes `.github/workflows/pr.yml`: the gates a pull request
must pass before it can merge. It is deliberately narrower than the whole
delivery story — the release lane (tag → image → attest → push) is a separate
workflow and is not claimed here.

## One required check: `ci-ok`

Eight jobs run in parallel. None of them is a required status check. The ruleset
requires exactly one string: **`ci-ok`**.

```text
lint ─┐
typecheck ─┤
test ─┤
image ─┤
trivy ─┼──▶ ci-ok   (if: always(), needs: [all eight])
gitleaks ─┤
migration-gate ─┤
bundle-size ─┘
```

Why an aggregator instead of eight required checks:

- a matrix job reports as `test (22)`, so a required check named `test` never
  matches — the PR would be green while the test job was red;
- eight literal names have to be kept in sync by hand in repository settings;
- `ci-ok` runs with `if: always()`, so a failed or skipped upstream job still
  produces a red check instead of leaving the PR waiting forever.

Required approvals are 0. A solo repository cannot approve its own PR; asking
for one approval either stalls every PR or gets bypassed, and a bypassed rule is
worse than a rule that matches reality.

## Gate → why

| Gate | What it runs | Why it exists | Red when |
|---|---|---|---|
| `lint` | `npm run lint` (ESLint 9 + typescript-eslint) | catches unsafe patterns the type checker accepts | any lint error |
| `typecheck` | `npm run typecheck` (`tsc --noEmit`) | a build can emit JavaScript from code that does not type-check; this cannot | any type error |
| `test` | `vitest run` against a `postgres:16` service, Node 22 | proves health/readiness, validation, 404 shape and DB round-trips against a real database | any of the 9 integration tests fails |
| `image` | Buildx build of `Dockerfile`, `load: true`, exported as an artifact | the scan must see the artifact that would ship, not the source tree | the image does not build |
| `trivy` | `trivy image` on the loaded artifact | base-image and bundled-dependency CVEs are invisible to a source scan | a CRITICAL or HIGH CVE with a fix available |
| `gitleaks` | `gitleaks/gitleaks-action` over the PR history | a secret in a commit is a secret even if the file is deleted later | a secret is found |
| `migration-gate` | fixture → `prisma migrate deploy` under locks → drift diff → destructive check | a migration that passes on an empty database can still fail or lock on production-shaped data | the migration fails, drifts, or is unlabelled destructive |
| `bundle-size` | `npm run build`, then `du -sk dist` against a 512 KiB budget | dependency creep is easier to stop at PR time than at runtime | `dist/` > 512 KiB |
| `ci-ok` | `jq` over `toJSON(needs)` | the single check the ruleset can name exactly | any upstream result is not `success` |

`ci-ok` is the only job with `permissions: {}` and no checkout: it reads job
results, nothing else.

## Details that are wrong if written the obvious way

- **Trivy must be allowed to fail the build.** `exit-code: '1'`,
  `severity: 'CRITICAL,HIGH'`, `ignore-unfixed: true`. Without `exit-code` the
  action reports findings and exits 0 — a gate that scans but never blocks.
- **The image must be loaded.** `docker/build-push-action` with `load: true`,
  then `docker save` / `docker load` for the `trivy` job. Without it the image
  exists only in the Buildx cache and `trivy image` has nothing local to scan.
- **Cache modes differ by branch.** `cache-from: type=gha,scope=invoice-api`
  and `cache-to` with `mode=max` only when `github.ref` is `refs/heads/main`;
  `mode=min` otherwise. PR refs cannot seed main's cache, and `mode=max` on
  every PR exhausts the 10 GB cache budget.
- **Lock timeouts belong in `PGOPTIONS`.** `prisma migrate deploy` opens its
  own session, so a `SET lock_timeout` in a previous step would not apply:
  `PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy`.
  This is what turns "the migration wedges the deploy" into "the gate fails in
  three seconds".
- **`prisma migrate diff --exit-code` has three outcomes.** 0 = no drift,
  2 = drift, 1 = the command failed. The step handles 0 and 2 explicitly and
  treats 1 as a failure; it does not use `continue-on-error` or `|| true`.
- **Every action is pinned to a full commit SHA**, with `.github/dependabot.yml`
  (`github-actions` ecosystem) keeping the SHAs current. No `@master`, no
  version tags in `uses:`.
- **Permissions are declared per job.** The workflow starts from
  `permissions: {}`; `trivy` additionally requires `security-events: write` to
  upload SARIF, and `gitleaks` requires `pull-requests: read`.
- **The migration gate uses two URLs.** Prisma needs `?schema=public`; libpq
  (and therefore `psql`) rejects `schema` as an unknown URI parameter. The
  fixture step uses `PSQL_URL` without the query string.

## The migration gate, step by step

1. `psql fixtures/pre-release.sql` builds a database that looks like the last
   release: tables, indexes, four rows, and a `_prisma_migrations` row whose
   checksum is sha256 of the baseline migration. Without that row,
   `migrate deploy` would try to create tables the fixture already created.
2. `PGOPTIONS=... npx prisma migrate deploy` applies only migrations the
   previous release does not have, under a 3 s lock timeout and a 30 s
   statement timeout.
3. `npx prisma migrate diff --from-url ... --to-schema-datamodel ...
   --exit-code` compares the migrated database with `prisma/schema.prisma`.
   Exit 2 means the migration history and the schema disagree.
4. `scripts/check-destructive.sh prisma/migrations` strips SQL comments, then
   requires any `DROP`, `RENAME` or `TRUNCATE` migration to carry both:

   ```sql
   -- destructive: <what is lost, and why that is acceptable>
   -- expand-contract: <how the previous release keeps working during the swap>
   ```

   The expand/contract note is the precondition for the rollback described in
   `docs/ROLLBACK.md`: a destructive change without one cannot be rolled back
   safely regardless of how good the deploy state machine is.

## Two lanes, never conflated

- **CI lane:** build → scan → attest → push. This document covers only its PR
  half (build + scan). Attestation and GHCR are the release lane.
- **Local lane:** `scripts/release-local.sh` → swap → wait for health → smoke →
  rollback, with `deploy.log` as evidence.

The CI lane cannot deploy: the runner cannot reach this machine, and there is
no paid staging host (decision recorded 2026-10-22). Neither lane stands in for
the other.

## Not executed here

This repository has **no git remote**. `git remote -v` is empty. Nothing in
`.github/workflows/pr.yml` can run, and no run URL, check result, attestation
or red PR exists. This is the reason, not a missing step.

- **GitHub Actions has never executed these jobs.** What was checked locally:
  the workflow parses as YAML; the eight jobs and the `ci-ok` aggregator are
  present; `ci-ok` needs all eight and uses `if: always()`; every `uses:` is a
  40-character commit SHA; the forbidden constructs (`continue-on-error`,
  `|| true`, `@master`) are absent. See `docs/EVIDENCE.md` for the commands and
  their output. A YAML parse is not a run.
- **Attestations do not exist.** There is no `release.yml` in this repository
  yet, no registry push, and no OIDC token without Actions. No provenance or
  SBOM claim is made here.
- **The red PR does not exist.** A PR requires a remote. Its exact intended
  body, the deliberately vulnerable dependency and the expected failing job
  (`trivy`) are recorded in `docs/EVIDENCE.md`, marked unexecuted.
- **The image has not been built.** The Docker daemon is unavailable on this
  machine (`docker info` → pipe access denied, recorded in C0). `Dockerfile`
  is written for the runner; it is unverified here.
- **The migration gate was verified against a local PostgreSQL 16**, in a
  scratch database created for the test and dropped afterwards. That proves the
  fixture and the commands, not that the Actions service container behaves
  identically.

To see it execute, a reviewer needs to: create a remote, push `master` as
`main`, enable Actions, add a ruleset requiring the status check `ci-ok`, and
open the draft PR described in `docs/EVIDENCE.md`. The workflows are written to
run there unmodified; they are not claimed to have run here.
