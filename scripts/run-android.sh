#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. Install Android platform-tools and add adb to PATH."
  exit 1
fi

adb start-server >/dev/null 2>&1 || true

AUTHORIZED_DEVICES=()
UNAUTHORIZED_DEVICES=()

while IFS= read -r serial; do
  if [[ -n "${serial}" ]]; then
    AUTHORIZED_DEVICES+=("${serial}")
  fi
done < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')

while IFS= read -r serial; do
  if [[ -n "${serial}" ]]; then
    UNAUTHORIZED_DEVICES+=("${serial}")
  fi
done < <(adb devices | awk 'NR>1 && $2=="unauthorized" {print $1}')

if [[ ${#UNAUTHORIZED_DEVICES[@]} -gt 0 && ${#AUTHORIZED_DEVICES[@]} -eq 0 ]]; then
  echo ""
  echo "Android device is connected but not authorized for USB debugging:"
  for serial in "${UNAUTHORIZED_DEVICES[@]}"; do
    echo "- ${serial}"
  done
  echo ""
  echo "Fix steps:"
  echo "1) Unlock the Android phone and keep screen on."
  echo "2) Reconnect USB cable and tap 'Allow USB debugging'."
  echo "3) If prompt does not appear:"
  echo "   - Run: adb kill-server && adb start-server"
  echo "   - On phone: Developer options -> Revoke USB debugging authorizations"
  echo "   - Reconnect cable and accept the fingerprint prompt"
  echo "4) Verify with: adb devices"
  echo ""
  echo "When authorized, run: npm run android"
  exit 1
fi

if [[ ${#AUTHORIZED_DEVICES[@]} -gt 0 ]]; then
  DEVICE_SERIAL="${1:-${AUTHORIZED_DEVICES[0]}}"

  echo "Using authorized Android device: ${DEVICE_SERIAL}"
  echo "Configuring adb reverse on ${DEVICE_SERIAL}..."
  adb -s "${DEVICE_SERIAL}" reverse tcp:8081 tcp:8081 >/dev/null || true
  adb -s "${DEVICE_SERIAL}" reverse tcp:19000 tcp:19000 >/dev/null || true
  adb -s "${DEVICE_SERIAL}" reverse tcp:19001 tcp:19001 >/dev/null || true

  cd "${PROJECT_ROOT}"
  ANDROID_SERIAL="${DEVICE_SERIAL}" npx expo run:android
  exit 0
fi

echo "No physical Android device detected. Trying emulator/default target..."
cd "${PROJECT_ROOT}"
npx expo run:android
