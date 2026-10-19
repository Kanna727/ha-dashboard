#!/usr/bin/env bash
# Builds the preview: the mock dashboard (fake data from the example config,
# the sky test panel open) for /local/dashboard/preview/ in Home Assistant.
#   scripts/build-preview.sh <version>
# Writes dist-preview/index.html and dist-preview/version.json, which the page
# polls to reload itself when a newer preview is deployed.
set -euo pipefail
version="${1:?usage: scripts/build-preview.sh <version>}"
VITE_MOCK=1 VITE_PREVIEW=1 BUILD_HASH="$version" npx vite build --outDir dist-preview --emptyOutDir
printf '{"version":"%s"}\n' "$version" > dist-preview/version.json
echo "Preview $version built in dist-preview/"
