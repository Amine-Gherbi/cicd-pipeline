#!/usr/bin/env bash
# Single verification entry point: lint, typecheck, integration tests.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> lint"
npm run lint

echo "==> typecheck"
npm run typecheck

echo "==> test"
npm run test

echo "verify: ok"
