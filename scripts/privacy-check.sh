#!/bin/sh
# Fails if tracked (or staged) files contain personal strings: names, account
# IDs, device serials. The patterns themselves are private, so they live in
# .privacy-patterns (gitignored, one extended regex per line) locally and in
# the PRIVACY_PATTERNS secret in CI.
#   scripts/privacy-check.sh           check the working tree's tracked files
#   scripts/privacy-check.sh --staged  check what is about to be committed
set -eu
cd "$(git rev-parse --show-toplevel)"
patterns=$(mktemp)
trap 'rm -f "$patterns"' EXIT
if [ -n "${PRIVACY_PATTERNS:-}" ]; then
  printf '%s\n' "$PRIVACY_PATTERNS" > "$patterns"
elif [ -f .privacy-patterns ]; then
  cp .privacy-patterns "$patterns"
else
  echo "privacy-check: no .privacy-patterns file or PRIVACY_PATTERNS env; skipping" >&2
  exit 0
fi
sed -i.bak '/^[[:space:]]*$/d; /^#/d' "$patterns" && rm -f "$patterns.bak"
[ -s "$patterns" ] || exit 0
if [ "${1:-}" = "--staged" ]; then
  hits=$(git grep --cached -I -n -i -E -f "$patterns" -- . ':!scripts/privacy-check.sh' || true)
else
  hits=$(git grep -I -n -i -E -f "$patterns" -- . ':!scripts/privacy-check.sh' || true)
fi
if [ -n "$hits" ]; then
  echo "privacy-check: personal data found (move it to config/dashboard.config.ts or CLAUDE.local.md):" >&2
  echo "$hits" | cut -c1-160 >&2
  exit 1
fi
