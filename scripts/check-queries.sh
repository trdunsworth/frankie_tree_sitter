#!/usr/bin/env bash
# Compile-check every query file in queries/. Thin loop around check-query.sh
# so CI and local runs share one code path: bash scripts/check-queries.sh
# [sample-fk].
set -uo pipefail
cd "$(dirname "$0")/.."

sample="${1:-}"
if [ -z "$sample" ]; then
  sample=$(ls examples/*.fk 2>/dev/null | head -1)
fi
if [ -z "$sample" ]; then
  echo "no .fk fixture found for query compilation"
  exit 1
fi

fail=0
for q in queries/*.scm; do
  if bash scripts/check-query.sh "$q" "$sample" > /dev/null 2>&1; then
    printf '%-32s ok\n' "$q"
  else
    printf '%-32s FAILED\n' "$q"
    fail=$((fail + 1))
  fi
done
exit $fail
