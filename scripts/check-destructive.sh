#!/usr/bin/env bash
# Fail a migration that drops or renames state without declaring itself.
#
# A migration containing DROP / RENAME / TRUNCATE must carry both:
#   -- destructive: <what is lost, and why that is acceptable>
#   -- expand-contract: <how the previous release keeps working during the swap>
#
# The second line is what makes the rollback in docs/ROLLBACK.md possible: a
# destructive change that is not expand/contract cannot be rolled back safely,
# no matter how good the deploy state machine is.
#
# Usage: bash scripts/check-destructive.sh [migrations-dir]
set -euo pipefail

target=${1:-prisma/migrations}

if [ ! -d "$target" ]; then
  echo "check-destructive: $target is not a directory" >&2
  exit 2
fi

violations=0
checked=0

while IFS= read -r -d '' file; do
  checked=$((checked + 1))

  # Strip line comments before matching, so a note that merely mentions DROP
  # is not treated as a destructive statement. Naive about `--` inside string
  # literals, which Prisma migrations do not use for DDL.
  statements=$(sed -E 's/--.*$//' "$file")

  if ! printf '%s\n' "$statements" | grep -Eiq '\b(DROP|RENAME|TRUNCATE)\b'; then
    continue
  fi

  if ! grep -Eiq '^[[:space:]]*--[[:space:]]*destructive[[:space:]]*:' "$file"; then
    echo "check-destructive: $file drops or renames state but has no '-- destructive:' label" >&2
    violations=$((violations + 1))
    continue
  fi

  if ! grep -Eiq '^[[:space:]]*--[[:space:]]*expand-contract[[:space:]]*:' "$file"; then
    echo "check-destructive: $file is labelled destructive but has no '-- expand-contract:' note" >&2
    violations=$((violations + 1))
  fi
done < <(find "$target" -type f -name '*.sql' -print0)

if [ "$violations" -ne 0 ]; then
  echo "check-destructive: $violations violation(s) across $checked migration file(s)" >&2
  exit 1
fi

echo "check-destructive: $checked migration file(s) checked, no unlabelled destructive statements"
