#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${1:-}" ]]; then
  echo "Usage: npm run ios:launch-device -- <DEVICE_UDID> [BUNDLE_ID]"
  echo "Example: npm run ios:launch-device -- 00008110-001C195E3E6B801E"
  exit 1
fi

DEVICE_UDID="$1"

if [[ -n "${2:-}" ]]; then
  BUNDLE_ID="$2"
else
  BUNDLE_ID="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('${PROJECT_ROOT}/app.json','utf8'));process.stdout.write(p?.expo?.ios?.bundleIdentifier||'');")"
fi

if [[ -z "$BUNDLE_ID" ]]; then
  echo "Unable to resolve iOS bundle identifier from app.json."
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun not found. Install Xcode and Xcode command line tools first."
  exit 1
fi

if ! xcrun -f devicectl >/dev/null 2>&1; then
  echo "xcrun devicectl not available."
  echo "Fix by selecting full Xcode developer tools:"
  echo "  sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer"
  echo "Then run once:"
  echo "  sudo xcodebuild -runFirstLaunch"
  exit 1
fi

echo "Launching ${BUNDLE_ID} on device ${DEVICE_UDID}..."
xcrun devicectl device process launch --device "$DEVICE_UDID" "$BUNDLE_ID"
echo "Launch command sent successfully."
