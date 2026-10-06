#!/usr/bin/env bash
# Compile-check a single query pattern for hangs / errors.
# usage: scripts/check-query.sh <query-file> [path]...
# The query file is compiled and run against the given paths (default: all
# example files). Exits non-zero on a compile error, and kills the run (exit
# 124-style) if tree-sitter 0.27's query compiler hangs.
set -uo pipefail

qfile="${1:?usage: check-query.sh <query-file> [paths...]}"
shift || true
if [ "$#" -eq 0 ]; then
  # shellcheck disable=SC2046
  set -- $(ls examples/*.fk test/fixtures/*.fk 2>/dev/null)
fi

out=$(mktemp)
err=$(mktemp)
tree-sitter query -q "$qfile" "$@" >"$out" 2>"$err" &
pid=$!

# Portable timeout (no `timeout` on stock macOS).
limit="${QUERY_TIMEOUT:-20}"
(
  sleep "$limit"
  kill -9 "$pid" 2>/dev/null
) &
killer=$!

wait "$pid"
status=$?
kill "$killer" 2>/dev/null
wait "$killer" 2>/dev/null

if grep -qiE 'error|panic' "$err"; then
  echo "COMPILE-ERROR in $qfile:"
  cat "$err"
  rm -f "$out" "$err"
  exit 1
fi
if [ "$status" -ne 0 ]; then
  echo "HANG/FAILURE ($status) in $qfile after ${limit}s"
  rm -f "$out" "$err"
  exit 124
fi
echo "OK $qfile"
rm -f "$out" "$err"
exit 0
