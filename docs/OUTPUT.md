# Command output

Captured on 2026-10-23 on the machine described in `docs/PROOF.md`: Windows 11,
Git Bash 5.2.37, Node v22.23.4, PostgreSQL 16 on `localhost:5433`, service on
`127.0.0.1:8787`, Docker engine 28.1.1, HEAD
`d014b82b290edc97a3e66a134d9c2bdbcfc3f6af` (the two consecutive demo runs below
were captured later at `29e806527f5b5125519a15317587393c76fe0d51`).

Each block is a real run. ANSI colour escapes were removed from the two Vitest
transcripts; the lines are otherwise exactly as printed. A block is trimmed
only where it says so. `deploy.log` timestamps are UTC.
The 2026-10-29 green-lane captures are in “Green-lane verification” below.

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

## Two consecutive `PORT=8787 bash scripts/demo.sh` runs

The earlier `demo.sh` capture above predates this change and is kept as history.
The two runs below were captured 2026-10-23 at HEAD
`29e806527f5b5125519a15317587393c76fe0d51`, one directly after the other. **Run 1 exit code: 0. Run 2 exit code: 0.** No process was killed
by hand between them: the second run found the service that the first run left on
port 8787, verified from its command line that it was running a release inside this
repository, stopped it, and rebuilt.

### Run 1

Command:

```bash
PORT=8787 bash scripts/demo.sh
```

Exit code: 0. Output:

```text
==> demo: stopping pid 19304 on port 8787 before building (its command line runs a release in this repo: C:\Users\interview\AppData\Local\fnm_multishells\14012_1792769349651\node.exe dist/server.js --release-dir P:\portfolio\cicd-pipeline\.releases\29e806527f5b5125519a15317587393c76fe0d51-20261023T153902Z-5899)
==> demo: healthy release 29e806527f5b5125519a15317587393c76fe0d51
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 29e806527f5b5125519a15317587393c76fe0d51 (release 29e806527f5b5125519a15317587393c76fe0d51, dirty=1)
==> build
==> PREVIOUS_REF=.releases/29e806527f5b5125519a15317587393c76fe0d51-20261023T153902Z-5899
==> built .releases/29e806527f5b5125519a15317587393c76fe0d51
==> current -> .releases/29e806527f5b5125519a15317587393c76fe0d51
service is not running (no pid file)
started release .releases/29e806527f5b5125519a15317587393c76fe0d51 (pid 19768) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 8.7ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
==> smoke.ok
release 29e806527f5b5125519a15317587393c76fe0d51 is live on http://127.0.0.1:8787

==> demo: deliberately broken release 29e806527f5b5125519a15317587393c76fe0d51 (RELEASE_FAULT=invoices-500)
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 29e806527f5b5125519a15317587393c76fe0d51 (release 29e806527f5b5125519a15317587393c76fe0d51-broken, dirty=1)
==> build
==> injected deliberate fault: invoices-500
==> PREVIOUS_REF=.releases/29e806527f5b5125519a15317587393c76fe0d51
==> built .releases/29e806527f5b5125519a15317587393c76fe0d51-broken
==> current -> .releases/29e806527f5b5125519a15317587393c76fe0d51-broken
stopped pid 19768
started release .releases/29e806527f5b5125519a15317587393c76fe0d51-broken (pid 19216) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51-broken)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
FAIL 3/5 POST /invoices authenticated — authenticated request returned 500, expected 201
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 9.8ms < 300ms (5 warm samples)
smoke: FAIL (1 of 5 assertions)
smoke gate failed
==> rollback to .releases/29e806527f5b5125519a15317587393c76fe0d51
stopped pid 19216
started release .releases/29e806527f5b5125519a15317587393c76fe0d51 (pid 21628) on 127.0.0.1:8787
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 11.4ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
rollback complete: .releases/29e806527f5b5125519a15317587393c76fe0d51 is live and passes smoke
rolled back to .releases/29e806527f5b5125519a15317587393c76fe0d51 after smoke.fail

demo summary
step                      result       expected  elapsed
------------------------  ----------   --------  -------
release (healthy)         PASS         PASS      15s
smoke (healthy)           PASS         PASS      5s
release (broken)          PASS         PASS      15s
smoke (broken)            FAIL         FAIL      5s
rollback                  PASS         PASS      14s
demo: service state - pid 21628 is the only listener on port 8787 and matches .deploy/service.pid
demo: ok - rollback verified
```

### Run 2 (immediately after)

Command:

```bash
PORT=8787 bash scripts/demo.sh
```

Exit code: 0. Output:

```text
==> demo: stopping pid 21628 on port 8787 before building (its command line runs a release in this repo: C:\Users\interview\AppData\Local\fnm_multishells\14012_1792769349651\node.exe dist/server.js --release-dir P:\portfolio\cicd-pipeline\.releases\29e806527f5b5125519a15317587393c76fe0d51)
==> demo: healthy release 29e806527f5b5125519a15317587393c76fe0d51
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 29e806527f5b5125519a15317587393c76fe0d51 (release 29e806527f5b5125519a15317587393c76fe0d51, dirty=1)
==> build
==> PREVIOUS_REF=.releases/29e806527f5b5125519a15317587393c76fe0d51
==> built .releases/29e806527f5b5125519a15317587393c76fe0d51
==> current -> .releases/29e806527f5b5125519a15317587393c76fe0d51
service is not running (no pid file)
started release .releases/29e806527f5b5125519a15317587393c76fe0d51 (pid 3832) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 9.2ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
==> smoke.ok
release 29e806527f5b5125519a15317587393c76fe0d51 is live on http://127.0.0.1:8787

==> demo: deliberately broken release 29e806527f5b5125519a15317587393c76fe0d51 (RELEASE_FAULT=invoices-500)
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 29e806527f5b5125519a15317587393c76fe0d51 (release 29e806527f5b5125519a15317587393c76fe0d51-broken, dirty=1)
==> build
==> injected deliberate fault: invoices-500
==> PREVIOUS_REF=.releases/29e806527f5b5125519a15317587393c76fe0d51
==> built .releases/29e806527f5b5125519a15317587393c76fe0d51-broken
==> current -> .releases/29e806527f5b5125519a15317587393c76fe0d51-broken
stopped pid 3832
started release .releases/29e806527f5b5125519a15317587393c76fe0d51-broken (pid 21384) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51-broken)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
FAIL 3/5 POST /invoices authenticated — authenticated request returned 500, expected 201
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 7.5ms < 300ms (5 warm samples)
smoke: FAIL (1 of 5 assertions)
smoke gate failed
==> rollback to .releases/29e806527f5b5125519a15317587393c76fe0d51
stopped pid 21384
started release .releases/29e806527f5b5125519a15317587393c76fe0d51 (pid 17444) on 127.0.0.1:8787
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 8.6ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
rollback complete: .releases/29e806527f5b5125519a15317587393c76fe0d51 is live and passes smoke
rolled back to .releases/29e806527f5b5125519a15317587393c76fe0d51 after smoke.fail

demo summary
step                      result       expected  elapsed
------------------------  ----------   --------  -------
release (healthy)         PASS         PASS      13s
smoke (healthy)           PASS         PASS      5s
release (broken)          PASS         PASS      15s
smoke (broken)            FAIL         FAIL      4s
rollback                  PASS         PASS      11s
demo: service state - pid 17444 is the only listener on port 8787 and matches .deploy/service.pid
demo: ok - rollback verified
```

The busy-directory fallback that makes run 1 possible is also exercised directly:
`bash scripts/release-local.sh 29e806527f5b5125519a15317587393c76fe0d51` while that
release was live printed

```text
==> .releases/29e806527f5b5125519a15317587393c76fe0d51 is busy (a process still holds it); building fresh release .releases/29e806527f5b5125519a15317587393c76fe0d51-20261023T153902Z-5899
```

and exited 0.

## Two consecutive `PORT=8787 bash scripts/demo.sh` runs after the WINPID/taskkill fix (P3-D4)

Captured 2026-10-23 at HEAD `29e806527f5b5125519a15317587393c76fe0d51` (deploy.log
events at `15:58:15Z` and `15:59:27Z`). Each run started with a live
`node dist/server.js` from the previous run already listening on 8787. **Run 1
exit code: 0. Run 2 exit code: 0.** The line
`demo: stopped WINPID <pid>; port 8787 free after <n>s` is printed only after
`netstat` no longer lists the port.

### Run 1

Command:

```bash
PORT=8787 bash scripts/demo.sh
```

Exit code: 0. Output:

```text
==> demo: stopping WINPID 7652 on port 8787 before building (its command line runs a release in this repo: C:\Users\interview\AppData\Local\fnm_multishells\20608_1792770741294\node.exe dist/server.js --release-dir P:\portfolio\cicd-pipeline\.releases\29e806527f5b5125519a15317587393c76fe0d51)
==> demo: stopped WINPID 7652; port 8787 free after 1.578s
==> demo: healthy release 29e806527f5b5125519a15317587393c76fe0d51
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 29e806527f5b5125519a15317587393c76fe0d51 (release 29e806527f5b5125519a15317587393c76fe0d51, dirty=1)
==> build
==> PREVIOUS_REF=.releases/29e806527f5b5125519a15317587393c76fe0d51
==> built .releases/29e806527f5b5125519a15317587393c76fe0d51
==> current -> .releases/29e806527f5b5125519a15317587393c76fe0d51
service is not running (no pid file)
started release .releases/29e806527f5b5125519a15317587393c76fe0d51 (pid 20848) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 9.1ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
==> smoke.ok
release 29e806527f5b5125519a15317587393c76fe0d51 is live on http://127.0.0.1:8787

==> demo: deliberately broken release 29e806527f5b5125519a15317587393c76fe0d51 (RELEASE_FAULT=invoices-500)
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 29e806527f5b5125519a15317587393c76fe0d51 (release 29e806527f5b5125519a15317587393c76fe0d51-broken, dirty=1)
==> build
==> injected deliberate fault: invoices-500
==> PREVIOUS_REF=.releases/29e806527f5b5125519a15317587393c76fe0d51
==> built .releases/29e806527f5b5125519a15317587393c76fe0d51-broken
==> current -> .releases/29e806527f5b5125519a15317587393c76fe0d51-broken
stopped WINPID 20848 after 100ms
started release .releases/29e806527f5b5125519a15317587393c76fe0d51-broken (pid 2524) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51-broken)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
FAIL 3/5 POST /invoices authenticated — authenticated request returned 500, expected 201
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 8.0ms < 300ms (5 warm samples)
smoke: FAIL (1 of 5 assertions)
smoke gate failed
==> rollback to .releases/29e806527f5b5125519a15317587393c76fe0d51
stopped WINPID 2524 after 100ms
started release .releases/29e806527f5b5125519a15317587393c76fe0d51 (pid 20588) on 127.0.0.1:8787
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 7.6ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
rollback complete: .releases/29e806527f5b5125519a15317587393c76fe0d51 is live and passes smoke
rolled back to .releases/29e806527f5b5125519a15317587393c76fe0d51 after smoke.fail

demo summary
step                      result       expected  elapsed
------------------------  ----------   --------  -------
release (healthy)         PASS         PASS      16s
smoke (healthy)           PASS         PASS      6s
release (broken)          PASS         PASS      15s
smoke (broken)            FAIL         FAIL      4s
rollback                  PASS         PASS      12s
demo: service state - pid 20588 is the only listener on port 8787 and matches .deploy/service.pid
demo: ok - rollback verified
```

### Run 2 (immediately after)

Command:

```bash
PORT=8787 bash scripts/demo.sh
```

Exit code: 0. Output:

```text
==> demo: stopping WINPID 20588 on port 8787 before building (its command line runs a release in this repo: C:\Users\interview\AppData\Local\fnm_multishells\20608_1792770741294\node.exe dist/server.js --release-dir P:\portfolio\cicd-pipeline\.releases\29e806527f5b5125519a15317587393c76fe0d51)
==> demo: stopped WINPID 20588; port 8787 free after 1.496s
==> demo: healthy release 29e806527f5b5125519a15317587393c76fe0d51
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 29e806527f5b5125519a15317587393c76fe0d51 (release 29e806527f5b5125519a15317587393c76fe0d51, dirty=1)
==> build
==> PREVIOUS_REF=.releases/29e806527f5b5125519a15317587393c76fe0d51
==> built .releases/29e806527f5b5125519a15317587393c76fe0d51
==> current -> .releases/29e806527f5b5125519a15317587393c76fe0d51
service is not running (no pid file)
started release .releases/29e806527f5b5125519a15317587393c76fe0d51 (pid 3364) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 8.9ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
==> smoke.ok
release 29e806527f5b5125519a15317587393c76fe0d51 is live on http://127.0.0.1:8787

==> demo: deliberately broken release 29e806527f5b5125519a15317587393c76fe0d51 (RELEASE_FAULT=invoices-500)
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 29e806527f5b5125519a15317587393c76fe0d51 (release 29e806527f5b5125519a15317587393c76fe0d51-broken, dirty=1)
==> build
==> injected deliberate fault: invoices-500
==> PREVIOUS_REF=.releases/29e806527f5b5125519a15317587393c76fe0d51
==> built .releases/29e806527f5b5125519a15317587393c76fe0d51-broken
==> current -> .releases/29e806527f5b5125519a15317587393c76fe0d51-broken
stopped WINPID 3364 after 100ms
started release .releases/29e806527f5b5125519a15317587393c76fe0d51-broken (pid 22116) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51-broken)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
FAIL 3/5 POST /invoices authenticated — authenticated request returned 500, expected 201
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 8.0ms < 300ms (5 warm samples)
smoke: FAIL (1 of 5 assertions)
smoke gate failed
==> rollback to .releases/29e806527f5b5125519a15317587393c76fe0d51
stopped WINPID 22116 after 100ms
started release .releases/29e806527f5b5125519a15317587393c76fe0d51 (pid 21004) on 127.0.0.1:8787
smoke: http://127.0.0.1:8787 (release .releases/29e806527f5b5125519a15317587393c76fe0d51)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 8.0ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
rollback complete: .releases/29e806527f5b5125519a15317587393c76fe0d51 is live and passes smoke
rolled back to .releases/29e806527f5b5125519a15317587393c76fe0d51 after smoke.fail

demo summary
step                      result       expected  elapsed
------------------------  ----------   --------  -------
release (healthy)         PASS         PASS      12s
smoke (healthy)           PASS         PASS      5s
release (broken)          PASS         PASS      15s
smoke (broken)            FAIL         FAIL      5s
rollback                  PASS         PASS      12s
demo: service state - pid 21004 is the only listener on port 8787 and matches .deploy/service.pid
demo: ok - rollback verified
```

## A foreign listener is refused, not killed

Captured 2026-10-23; exit code: 1. The listener was started from `/tmp` (not this
repository) so its command line does not name a release under
`P:\portfolio\cicd-pipeline\.releases\`:

```bash
cd /tmp && node -e 'require("http").createServer((q,s)=>s.end("x")).listen(8787)'
```

then, in the repository:

```bash
PORT=8787 bash scripts/demo.sh
```

Output:

```text
demo: port 8787 is held by 10460 (C:\Users\interview\AppData\Local\fnm_multishells\20608_1792770741294\node.exe -e "require(\"http\").createServer((q,s)=>s.end(\"x\")).listen(8787)")
```

The demo did not build, did not print a summary, and exited 1. `netstat -ano`
still showed `TCP 0.0.0.0:8787 ... LISTENING 10460` afterwards, so the foreign
process was left untouched; it was then stopped by hand with
`taskkill /PID 10460 /F /T`. The repository service was restarted with
`bash scripts/service.sh start` (pid 17708 on 127.0.0.1:8787).

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

## Green-lane verification — 2026-10-29

Branch `w3-b1-green-lane`, based on
`7fa7aa595d7d1ab5d32cbf62784e65ba8cac5977`. This card changes only
`.github/workflows/pr.yml` and documentation, so the image below is the one the
`image` and `publish` jobs build.

### `bash scripts/verify.sh`

Command:

```bash
bash scripts/verify.sh
```

Exit code: 0. Output trimmed to the section labels and the Vitest summary:

```text
==> lint
==> types
==> tests

 Test Files  1 passed (1)
      Tests  9 passed (9)

==> result
verify: ok
```

### `docker build` + the Trivy gate

Commands:

```bash
SHA=$(git rev-parse HEAD)
docker build -t "invoice-api:$SHA" .
trivy image --exit-code 1 --severity CRITICAL,HIGH --ignore-unfixed "invoice-api:$SHA"
```

Exit codes: build 0, scan 0. Docker 28.1.1; Trivy 0.76.1 with the vulnerability
DB updated 2026-10-29. The JSON report contains 2 targets (alpine 3.24.3 and
Node.js) and **0 CRITICAL, 0 HIGH findings**. The built image is
`sha256:b9d3fbc0fddc854ada74f5bce7a419b13682dbd4eea99bda94881a1241e927b8`.

### The green run

Not yet observed: the supervisor merges the branch and dispatches `pr.yml` on
`master`. Values stay as placeholders rather than invented numbers.

- Run URL: `RUN_URL_TBD`
- Pushed digest: `DIGEST_TBD`

## What is not here

- No green Actions output yet. Run 40902199280 exists and is quoted in
  `docs/EVIDENCE.md`; it failed in `trivy`. The green run is `RUN_URL_TBD`.
- No `cosign verify` or `gh attestation verify` output: no registry artifact
  exists yet. The pushed digest is `DIGEST_TBD`.
- No `npm run dev` transcript: the command starts a watcher and does not exit;
  the captured service output comes from the built release above.
