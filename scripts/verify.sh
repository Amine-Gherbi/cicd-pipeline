#!/usr/bin/env bash
# Single verification entry point: lint, types, tests.
#
# All three sections run even when one fails, so a single invocation shows
# every failure. The last line is exactly one of:
#   verify: ok
#   verify: FAILED
# Exit 0 only when all three sections passed.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

fail=0

echo "==> lint"
if npm run lint; then
  :
else
  fail=1
fi

echo "==> types"
if npm run typecheck; then
  :
else
  fail=1
fi

echo "==> tests"
if npm run test; then
  :
else
  fail=1
fi

echo "==> result"
if [ "$fail" -eq 0 ]; then
  echo "verify: ok"
  exit 0
fi

echo "verify: FAILED"
exit 1
