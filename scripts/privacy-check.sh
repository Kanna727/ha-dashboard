#!/bin/sh
# Fails if tracked (or staged) files contain personal data. Two layers:
#  1. Generic checks (scripts/privacy-generic.patterns, committed): API keys and
#     tokens, webhook IDs, credentials in URLs, email addresses, private and
#     Tailscale IPs, real-looking MAC addresses, and files that must never be
#     committed (.env*, *.local.*, 3D models, keys). They run for everyone,
#     including contributors and fork PRs.
#  2. Private patterns (names, account IDs, device serials) that live in
#     .privacy-patterns (gitignored, one extended regex per line) locally and in
#     the PRIVACY_PATTERNS secret in CI. Skipped when neither exists.
# A line containing "privacy-check: ok" is skipped by the generic layer: use it
# only for a deliberate, fictional example.
#   scripts/privacy-check.sh           check the working tree's tracked files
#   scripts/privacy-check.sh --staged  check what is about to be committed
set -eu
cd "$(git rev-parse --show-toplevel)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
staged=0
[ "${1:-}" = "--staged" ] && staged=1
cached=""
[ "$staged" = 1 ] && cached="--cached"
fail=0
excludes=":!package-lock.json :!scripts/car-model/package-lock.json :!scripts/privacy-check.sh :!scripts/privacy-check.test.sh :!scripts/privacy-generic.patterns"

# --- 1. generic checks ---
sed '/^[[:space:]]*$/d; /^#/d' scripts/privacy-generic.patterns > "$tmp/generic"
# Matches that are fine: documentation/example addresses, locally administered
# MACs (second hex digit 2, 6, A or E: never a real device's burned-in address),
# the TEST-NET IP ranges are not matched by the patterns at all.
allow='(@(example\.(com|org|net)|users\.noreply\.github\.com|noreply\.github\.com)$)|(^[0-9A-Fa-f][26AEae][:-])'
# shellcheck disable=SC2086
git grep $cached -I -n -E -f "$tmp/generic" -- . $excludes | { grep -F 'privacy-check: ok' || true; } \
  | cut -d: -f1,2 > "$tmp/skip"
# shellcheck disable=SC2086
git grep $cached -I -n -o -E -f "$tmp/generic" -- . $excludes \
  | ALLOW="$allow" awk '
      FILENAME == ARGV[1] { skip[$0] = 1; next }
      { i = index($0, ":"); rest = substr($0, i + 1); j = index(rest, ":");
        key = substr($0, 1, i + j - 1); m = substr(rest, j + 1);
        if (!(key in skip) && m !~ ENVIRON["ALLOW"]) print }' "$tmp/skip" - > "$tmp/generic.hits" || true
if [ -s "$tmp/generic.hits" ]; then
  echo "privacy-check: possible personal data or secrets (use fictional values; see CONTRIBUTING.md):" >&2
  cut -c1-160 "$tmp/generic.hits" >&2
  fail=1
fi
if [ "$staged" = 1 ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi
badfiles=$(printf '%s\n' "$files" | grep -E '(^|/)(\.env([^/]*)|[^/]*\.local\.[^/]*|[^/]*\.(glb|gltf|pem|key|p12|pfx))$' | grep -vE '(^|/)\.env\.example$' || true)
if [ -n "$badfiles" ]; then
  echo "privacy-check: files that must not be committed (local config, 3D models, keys):" >&2
  echo "$badfiles" >&2
  fail=1
fi

# --- 2. private patterns ---
patterns="$tmp/private"
if [ -n "${PRIVACY_PATTERNS:-}" ]; then
  printf '%s\n' "$PRIVACY_PATTERNS" > "$patterns"
elif [ -f .privacy-patterns ]; then
  cp .privacy-patterns "$patterns"
else
  echo "privacy-check: no .privacy-patterns file or PRIVACY_PATTERNS env; only the generic checks ran" >&2
  : > "$patterns"
fi
sed '/^[[:space:]]*$/d; /^#/d' "$patterns" > "$patterns.clean"
if [ -s "$patterns.clean" ]; then
  # shellcheck disable=SC2086
  hits=$(git grep $cached -I -n -i -E -f "$patterns.clean" -- . ':!scripts/privacy-check.sh' ':!scripts/privacy-check.test.sh' || true)
  if [ -n "$hits" ]; then
    echo "privacy-check: personal data found (move it to config/dashboard.config.ts or CLAUDE.local.md):" >&2
    echo "$hits" | cut -c1-160 >&2
    fail=1
  fi
fi
exit "$fail"
