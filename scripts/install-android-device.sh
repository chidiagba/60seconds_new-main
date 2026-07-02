#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. Install Android platform-tools and add adb to PATH."
  exit 1
fi

DEVICE_SERIAL="${1:-}"
if [[ -z "$DEVICE_SERIAL" ]]; then
  DEVICE_SERIAL="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
fi

if [[ -z "$DEVICE_SERIAL" ]]; then
  echo "No Android device detected. Connect a real device and enable USB debugging."
  exit 1
fi

echo "Configuring adb reverse on ${DEVICE_SERIAL}..."
adb -s "$DEVICE_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null || true
adb -s "$DEVICE_SERIAL" reverse tcp:19000 tcp:19000 >/dev/null || true
adb -s "$DEVICE_SERIAL" reverse tcp:19001 tcp:19001 >/dev/null || true

cd "$PROJECT_ROOT"
echo "Building and installing on Android device ${DEVICE_SERIAL}..."
ANDROID_SERIAL="$DEVICE_SERIAL" npx expo run:android
