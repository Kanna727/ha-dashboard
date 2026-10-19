#!/usr/bin/env bash
# Asks Home Assistant to install a preview build from a GitHub release of this
# repo (the vX.Y.Z release, or the rolling `preview` pre-release for pull
# requests). Run on a runner that has joined the tailnet.
#   scripts/ha-deploy-preview.sh <release tag> <version>
# Needs GH_TOKEN, HA_HOST and HA_PREVIEW_WEBHOOK_ID in the environment.
#
# HA downloads the files itself, from short-lived signed URLs (the repo is
# private), into www/dashboard/preview. version.json goes last: the page
# reloads when it changes, so index.html must already be in place.
set -euo pipefail
tag="${1:?usage: scripts/ha-deploy-preview.sh <release tag> <version>}"
version="${2:?usage: scripts/ha-deploy-preview.sh <release tag> <version>}"
: "${GH_TOKEN:?}" "${HA_HOST:?}" "${HA_PREVIEW_WEBHOOK_ID:?}"

assets=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag" --jq '.assets')
files='[]'
# release asset name → file name in www/dashboard/preview
for pair in preview-index.html:index.html preview-version.json:version.json; do
  asset="${pair%%:*}"
  name="${pair##*:}"
  id=$(jq -r --arg n "$asset" '.[] | select(.name == $n) | .id' <<<"$assets")
  # Releases from before previews existed have none: nothing to install.
  test -n "$id" || { echo "::warning::$asset is missing from release $tag; no preview deployed"; exit 0; }
  u=$(curl -sS -o /dev/null -w '%{redirect_url}' \
    -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/octet-stream" \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/releases/assets/$id")
  test -n "$u"
  files=$(jq --arg n "$name" --arg u "$u" '. + [{name: $n, url: $u}]' <<<"$files")
done
jq -n --arg version "$version" --argjson files "$files" '{version: $version, files: $files}' |
  curl -fsS --max-time 20 -X POST -H 'Content-Type: application/json' --data @- \
    "http://$HA_HOST/api/webhook/$HA_PREVIEW_WEBHOOK_ID"
echo "Asked Home Assistant to install preview $version"
