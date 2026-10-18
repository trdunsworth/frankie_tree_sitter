#!/usr/bin/env bash
# Check out the reference compiler the oracle runs against.
#
#   scripts/oracle/setup-ref.sh [dir]        # default .oracle/Frankie
#
# The reference compiler is that repo's own code: GPL-licensed, and something
# this repo deliberately does NOT vendor. A shallow clone of the pinned tag
# lands in a git-ignored directory; delete it any time. Passing a different
# dir (or setting FRANKIE_REF) lets the oracle try another revision.
set -euo pipefail

TAG="${FRANKIE_REF_TAG:-v1.22.3}"
DEST="${1:-${FRANKIE_REF:-.oracle/Frankie}}"

if [ -e "$DEST/compiler/parser.py" ]; then
  echo "reference compiler already at $DEST ($(git -C "$DEST" rev-parse HEAD)) — leaving it alone"
else
  mkdir -p "$(dirname "$DEST")"
  echo "cloning atejada/Frankie $TAG → $DEST"
  git clone --quiet --depth 1 --branch "$TAG" \
    https://github.com/atejada/Frankie.git "$DEST"
fi
echo "pinned revision: $(git -C "$DEST" rev-parse HEAD)  (tag $TAG)"
