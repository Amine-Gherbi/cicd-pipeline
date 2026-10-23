# Pipeline — the PR gate set

This document describes `.github/workflows/pr.yml`: the gates a pull request
must pass before it can merge. It is deliberately narrower than the whole
delivery story — the release lane (tag → image → attest → push) is not present
in this repository yet and is not claimed here. The promotion path below is a
documented, unexecuted path, not a run.

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

## Promotion path — a verified path, not a verified run

Promotion is **artifact-only**: P3 verifies the image P2 published, and never
imports P2's code. The image is the interface. The commit behind it is deployed
by the local lane, not by the CI lane.

Let `<owner>` be the account and `<digest>` the `sha256:…` digest P2's release
workflow pushed. A reviewer with registry access runs both checks:

```bash
# 1. The signature was made by P2's release workflow identity, keyless via OIDC.
digest=sha256:<digest>
cosign verify "ghcr.io/<owner>/ecommerce-platform@${digest}" \
  --certificate-identity-regexp '^https://github\.com/<owner>/ecommerce-platform/\.github/workflows/release\.yml@refs/heads/main$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'

# 2. The provenance attestation binds that digest to the repository and workflow.
gh attestation verify "oci://ghcr.io/<owner>/ecommerce-platform@${digest}" \
  --repo <owner>/ecommerce-platform \
  --signer-workflow <owner>/ecommerce-platform/.github/workflows/release.yml
```

What each command actually proves:

| Command | Proves | Does **not** prove |
|---|---|---|
| `cosign verify` | the digest was signed by that workflow's OIDC identity, so an arbitrary pusher cannot substitute it | that the image runs, or that the tests passed |
| `gh attestation verify` | the provenance statement ties the digest to the repository, commit and signing workflow | that the commit is safe to deploy |
| `release-local.sh` (P2 repository, same commit) | the attested commit can be built, swapped, waited for, smoked and rolled back on a machine | that the deployed bytes are the registry digest — the local lane builds from source |

The deploy half, run in the **P2 repository** (P3's `release-local.sh` deploys
`invoice-api`, not the Next app):

```bash
git -C ../ecommerce-platform rev-parse HEAD     # must be the attested revision
./scripts/release-local.sh "$(git -C ../ecommerce-platform rev-parse HEAD)"
```

**Status: `unverified`.** This machine has no git remote, no GHCR credentials
and no P2 run, so neither verify command nor the deploy has executed. It is a
verified *path* in the sense that the artifact boundary is enforced and each
failure mode is named; it is **not** a verified *run*. `docs/EVIDENCE.md`
records both commands as unverified rows.

The digest is never replaced by a tag: a tag can move, a digest cannot. That is
why the commands above take `@sha256:…` and why the local lane records the full
commit SHA in `.releases/<sha>/manifest.json`.

## Portable core

The same gate shapes are reused across the four projects; only the tooling
under each gate changes. Four copies of roughly 120 lines are deliberate: a
shared workflow repository would rename checks to `<caller> / <called>` and
silently unmatch every ruleset — the exact failure this project demonstrates it
understands.

| Gate | P1 Astro | P2 Next | **P3 invoice-api** | P4 Python |
|---|---|---|---|---|
| lint / type / unit | tsc + eslint | tsc + eslint + vitest | **tsc + eslint + vitest** | ruff + mypy + pytest |
| trivy fs + gitleaks | yes | yes | **yes** | yes |
| image build + scan + attest | no | yes (P2 owns the publish; verified from here only by command) | **yes (written, unverified here)** | yes |
| migration gate | no | Prisma | **Prisma + lock timeout + drift + destructive check** | Alembic |
| smoke | preview URL | preview deploy | **local release lane, 5 assertions** | eval report |
| release | static deploy | static deploy + image | **GHCR + tag (path only) + local swap** | GHCR + eval artifact |

The one string that must match repository settings is `ci-ok` in every project
that uses this shape. Nothing else is required by the ruleset.

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
