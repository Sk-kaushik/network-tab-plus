#!/bin/bash
# Builds the zip you upload to the Chrome Web Store.
set -e

cd "$(dirname "$0")"
VERSION=$(grep '"version"' extension/manifest.json | head -1 | sed 's/[^0-9.]//g')
OUT="network-tab-plus-${VERSION}.zip"

rm -f "$OUT"
cd extension
zip -r "../$OUT" . -x "*.DS_Store" -x "__MACOSX/*" > /dev/null
cd ..

echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
echo "Upload it at https://chrome.google.com/webstore/devconsole"
