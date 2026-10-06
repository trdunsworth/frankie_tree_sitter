#!/usr/bin/env bash
# Copy the grammar's build output into the VS Code extension directory.
#
#   scripts/build-vscode.sh        (or: cd vscode && npm run assets)
#
# The .wasm and the highlight query are build artifacts of this repository,
# not sources of the extension, so they are git-ignored on both sides and
# always taken from the freshly built grammar.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ext="$root/vscode"

echo "building tree-sitter-frankie.wasm"
(cd "$root" && tree-sitter build --wasm)

mkdir -p "$ext/queries"
cp "$root/tree-sitter-frankie.wasm" "$ext/tree-sitter-frankie.wasm"
cp "$root/queries/highlights.scm" "$ext/queries/highlights.scm"

echo "copied into $ext:"
ls -l "$ext/tree-sitter-frankie.wasm" "$ext/queries/highlights.scm"
