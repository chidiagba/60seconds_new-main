#!/usr/bin/env bash
set -euo pipefail

SIMULATOR_NAME="${IOS_SIMULATOR_NAME:-iPhone 17}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${IOS_BUNDLE_ID:-}" ]]; then
  BUNDLE_ID="${IOS_BUNDLE_ID}"
else
  BUNDLE_ID="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('${PROJECT_ROOT}/app.json','utf8'));process.stdout.write(p?.expo?.ios?.bundleIdentifier||'');")"
fi

if [[ -z "${BUNDLE_ID}" ]]; then
  echo "Unable to resolve iOS bundle identifier from app.json." >&2
  exit 1
fi

metro_status() {
  curl -fsS "http://127.0.0.1:8081/status" 2>/dev/null || true
}

echo "Booting simulator: ${SIMULATOR_NAME}"
open -a Simulator >/dev/null 2>&1 || true

DEVICE_UDID="$(xcrun simctl list devices available | grep -F "$SIMULATOR_NAME (" | head -n 1 | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/')"

if [[ -z "${DEVICE_UDID}" ]]; then
  echo "Could not find simulator: ${SIMULATOR_NAME}" >&2
  exit 1
fi

xcrun simctl boot "${DEVICE_UDID}" >/dev/null 2>&1 || true
xcrun simctl bootstatus "${DEVICE_UDID}" -b

if [[ "$(metro_status)" != "packager-status:running" ]]; then
  if lsof -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 8081 is in use, but Metro is not healthy. Restarting listener on 8081..."
    lsof -tiTCP:8081 -sTCP:LISTEN | xargs kill >/dev/null 2>&1 || true
  fi

  echo "Starting Metro on :8081"
  (
    cd "${PROJECT_ROOT}"
    nohup npx expo start --dev-client --host localhost >/tmp/60seconds-metro.log 2>&1 &
  )

  for _ in {1..30}; do
    if [[ "$(metro_status)" == "packager-status:running" ]]; then
      break
    fi
    sleep 1
  done

  if [[ "$(metro_status)" != "packager-status:running" ]]; then
    echo "Metro failed to start on :8081. Check /tmp/60seconds-metro.log" >&2
    tail -n 120 /tmp/60seconds-metro.log || true
    exit 1
  fi
fi

if xcrun simctl get_app_container "${DEVICE_UDID}" "${BUNDLE_ID}" app >/dev/null 2>&1; then
  echo "Launching installed app"
  xcrun simctl terminate "${DEVICE_UDID}" "${BUNDLE_ID}" >/dev/null 2>&1 || true
  xcrun simctl launch "${DEVICE_UDID}" "${BUNDLE_ID}"
  exit 0
fi

echo "App is not installed yet. Running first-time install build..."
cd "${PROJECT_ROOT}"
npx expo run:ios -d "${DEVICE_UDID}"
