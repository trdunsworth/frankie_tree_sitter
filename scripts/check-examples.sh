#!/usr/bin/env bash
# Parse every example .fk file and fail if any ERROR/MISSING node appears.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
count=0
for f in examples/*.fk; do
  [ -e "$f" ] || continue
  count=$((count + 1))
  out=$(tree-sitter parse "$f" 2>&1)
  if printf '%s' "$out" | grep -qE 'ERROR|MISSING'; then
    echo "FAIL: $f"
    printf '%s\n' "$out" | grep -E 'ERROR|MISSING' | head -5
    fail=$((fail + 1))
  fi
done

echo "----"
echo "parsed: $count  failed: $fail"
[ "$fail" -eq 0 ]
