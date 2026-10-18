#!/usr/bin/env bash
# Parse every example .fk file and fail if any tree carries an error.
#
# This asks the TREE itself (via scripts/tree-status.mjs) rather than
# `tree-sitter parse`'s text output.  When a terminal token is EXTERNAL — a
# heredoc's `_heredoc_end`, say — arriving error recovery wraps it in a
# zero-width `(MISSING _heredoc_end)` node that the CLI's printer omits, and
# the CLI still exits 0.  An unterminated heredoc is exactly that case, so a
# grep for `ERROR|MISSING` used to let it straight through.
set -uo pipefail
cd "$(dirname "$0")/.."

# The tree check runs on the wasm, which `npm run test:wasm` builds.  Build it
# here too so the script works standalone.
if [ ! -f tree-sitter-frankie.wasm ]; then
  echo "(building tree-sitter-frankie.wasm for the tree check)"
  tree-sitter build --wasm >/dev/null
fi

fail=0
count=0
while read -r status path; do
  count=$((count + 1))
  if [ "$status" = "ERR" ]; then
    echo "FAIL: $path"
    fail=$((fail + 1))
  fi
done < <(node scripts/tree-status.mjs examples/*.fk)

echo "----"
echo "parsed: $count  failed: $fail"
[ "$fail" -eq 0 ]
