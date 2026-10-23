# Command output

Captured on 2026-10-23 on the machine described in `docs/PROOF.md`: Windows 11,
Git Bash 5.2.37, Node v22.23.4, PostgreSQL 16 on `localhost:5433`, service on
`127.0.0.1:8787`, Docker engine 28.1.1, HEAD
`d014b82b290edc97a3e66a134d9c2bdbcfc3f6af`.

Each block is a real run. ANSI colour escapes were removed from the two Vitest
transcripts; the lines are otherwise exactly as printed. A block is trimmed
only where it says so. `deploy.log` timestamps are UTC.

## `bash scripts/verify.sh`

Command:

```bash
bash scripts/verify.sh
```

Captured 2026-10-23; exit code: 0. A second consecutive run also exited 0 with the same four section
labels and `verify: ok`.

Output:

```text
==> lint

> invoice-api@0.0.0 lint
> eslint .

==> types

> invoice-api@0.0.0 typecheck
> tsc --noEmit

==> tests

> invoice-api@0.0.0 test
> vitest run


 RUN  v3.2.7 P:/portfolio/cicd-pipeline

 ✓ tests/integration/api.test.ts (9 tests) 6150ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  16:06:59
   Duration  7.62s (transform 185ms, setup 0ms, collect 791ms, tests 6.15s, environment 0ms, prepare 216ms)

==> result
verify: ok
```

## `bash scripts/demo.sh`

Command:

```bash
bash scripts/demo.sh
```

Captured 2026-10-23; exit code: 0.

Output:

```text
==> demo: stopping .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af before rebuilding it
stopped pid 2580
==> demo: healthy release d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (release d014b82b290edc97a3e66a134d9c2bdbcfc3f6af, dirty=1)
==> build
==> PREVIOUS_REF=.releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
==> built .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
==> current -> .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
service is not running (no pid file)
started release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (pid 2712) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 21.5ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
==> smoke.ok
release d014b82b290edc97a3e66a134d9c2bdbcfc3f6af is live on http://127.0.0.1:8787

==> demo: deliberately broken release d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (RELEASE_FAULT=invoices-500)
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (release d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken, dirty=1)
==> build
==> injected deliberate fault: invoices-500
==> PREVIOUS_REF=.releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
==> built .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken
==> current -> .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken
stopped pid 2712
started release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken (pid 2835) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
FAIL 3/5 POST /invoices authenticated — authenticated request returned 500, expected 201
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 7.8ms < 300ms (5 warm samples)
smoke: FAIL (1 of 5 assertions)
smoke gate failed
==> rollback to .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
stopped pid 2835
started release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (pid 2916) on 127.0.0.1:8787
smoke: http://127.0.0.1:8787 (release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 7.1ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
rollback complete: .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af is live and passes smoke
rolled back to .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af after smoke.fail

demo summary
step                      result       expected  elapsed
------------------------  ----------   --------  -------
release (healthy)         PASS         PASS      10s
smoke (healthy)           PASS         PASS      5s
release (broken)          PASS         PASS      10s
smoke (broken)            FAIL         FAIL      3s
rollback                  PASS         PASS      7s
demo: ok - rollback verified
```

## `bash scripts/release-local.sh <sha>`

The healthy run below was captured after `bash scripts/service.sh stop`
(exit 0). This host cannot move a release directory that is the running
process's working directory, so `demo.sh` stops the current release before
rebuilding the same path.

Command:

```bash
bash scripts/release-local.sh d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
```

Captured 2026-10-23; exit code: 0.

Output:

```text
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (release d014b82b290edc97a3e66a134d9c2bdbcfc3f6af, dirty=1)
==> build
==> PREVIOUS_REF=.releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
==> built .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
==> current -> .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
service is not running (no pid file)
started release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (pid 2385) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 8.5ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
==> smoke.ok
release d014b82b290edc97a3e66a134d9c2bdbcfc3f6af is live on http://127.0.0.1:8787
```

## `bash scripts/release-local.sh <sha> broken` (deliberate fault)

Command:

```bash
RELEASE_FAULT=invoices-500 bash scripts/release-local.sh d014b82b290edc97a3e66a134d9c2bdbcfc3f6af broken
```

Captured 2026-10-23; exit code: 1. The deploy gate fired; the rollback succeeded and the previous
release is live. A non-zero exit is the correct result for a failed deploy.

Output:

```text
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (release d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken, dirty=1)
==> build
==> injected deliberate fault: invoices-500
==> PREVIOUS_REF=.releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
==> built .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken
==> current -> .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken
stopped pid 2385
started release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken (pid 2499) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af-broken)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
FAIL 3/5 POST /invoices authenticated — authenticated request returned 500, expected 201
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 9.0ms < 300ms (5 warm samples)
smoke: FAIL (1 of 5 assertions)
smoke gate failed
==> rollback to .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
stopped pid 2499
started release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af (pid 2580) on 127.0.0.1:8787
smoke: http://127.0.0.1:8787 (release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 7.7ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
rollback complete: .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af is live and passes smoke
rolled back to .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af after smoke.fail
```

## `bash scripts/smoke.sh`

Command:

```bash
bash scripts/smoke.sh
```

Captured 2026-10-23; exit code: 0.

Output:

```text
smoke: http://127.0.0.1:8787 (release .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 7.0ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
```

## `bash scripts/release-local.sh status`

Command:

```bash
bash scripts/release-local.sh status
```

Captured 2026-10-23; exit code: 0. The last six of the twenty printed log lines are shown.

Output:

```text
current:  .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
previous: .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
pid:      2916 (alive)
--- deploy.log (last 20 lines) ---
deploy.start d014b82b290edc97a3e66a134d9c2bdbcfc3f6af 2026-10-23T15:08:24Z
health.ok 2026-10-23T15:08:34Z
smoke.fail 2026-10-23T15:08:37Z
rollback.start 2026-10-23T15:08:38Z
rollback.health.ok 2026-10-23T15:08:40Z
rollback.smoke.ok 2026-10-23T15:08:45Z
```

## `bash scripts/service.sh status` (and `stop`)

Command:

```bash
bash scripts/service.sh status
```

Captured 2026-10-23; exit code: 0.

Output:

```text
current:  .releases/d014b82b290edc97a3e66a134d9c2bdbcfc3f6af
running:  yes
pid:      2916 (alive)
port:     8787
log:      /p/portfolio/cicd-pipeline/.deploy/service.log
```

`bash scripts/service.sh stop` printed `stopped pid 2016` and exited 0 in the
capture run that preceded the healthy release above. `start` and `restart` are
exercised by `release-local.sh`; their output is the `started release ...` line
in the release transcripts.

## `bash scripts/check-destructive.sh prisma/migrations`

Command:

```bash
bash scripts/check-destructive.sh prisma/migrations
```

Captured 2026-10-23; exit code: 0.

Output:

```text
check-destructive: 1 migration file(s) checked, no unlabelled destructive statements
```

## `npx prisma migrate deploy`

Command:

```bash
PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy
```

Captured 2026-10-23; exit code: 0.

Output:

```text
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "invoice_dev", schema "public" at "localhost:5433"

1 migration found in prisma/migrations


No pending migrations to apply.
```

## `npm run test`

Command:

```bash
npm run test
```

Captured 2026-10-23; exit code: 0.

Output:

```text
> invoice-api@0.0.0 test
> vitest run


 RUN  v3.2.7 P:/portfolio/cicd-pipeline

 ✓ tests/integration/api.test.ts (9 tests) 6500ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  16:09:00
   Duration  8.11s (transform 206ms, setup 0ms, collect 891ms, tests 6.50s, environment 1ms, prepare 248ms)
```

## `npm run build`

Command:

```bash
npm run build
```

Captured 2026-10-23; exit code: 0.

Output:

```text
> invoice-api@0.0.0 build
> tsc -p tsconfig.build.json
```

## `node scripts/capture-assets.mjs`

Command:

```bash
OUT_DIR=.deploy/assets-preview node scripts/capture-assets.mjs
```

Captured 2026-10-23; exit code: 0. `./scripts/capture-assets` is the same command without the
`OUT_DIR` override; its default output directory is
`P:/portfolio/_shared/assets/cicd-pipeline/`, outside this repository, so the
captured run wrote inside `.deploy/` instead.

Output:

```text
[capture] hero.webp 2880x1800 webp 161 KiB
[capture] shot-01.webp 2880x1800 webp 166 KiB
[capture] shot-02.webp 2880x1800 webp 138 KiB
[capture] shot-03.webp 2880x1800 webp 187 KiB
[capture] manifest.json 4 shots, 6 measurements, 3 invariants, 5 limits
[capture] wrote P:\portfolio\cicd-pipeline\.deploy\assets-preview
```

## `docker image ls invoice-api`

Read-only check of the two images measured in `docs/EVIDENCE.md`. No build or
scan was run for this document.

Command:

```bash
docker image ls invoice-api
```

Captured 2026-10-23; exit code: 0.

Output:

```text
REPOSITORY    TAG       IMAGE ID       CREATED       SIZE
invoice-api   slim      b9d3fbc0fddc   6 hours ago   284MB
invoice-api   local     881604849cd3   8 hours ago   535MB
```

## What is not here

- No GitHub Actions output: `git remote -v` is empty, so no run exists.
- No `cosign verify` or `gh attestation verify` output: no registry artifact
  exists.
- No `npm run dev` transcript: the command starts a watcher and does not exit;
  the captured service output comes from the built release above.
