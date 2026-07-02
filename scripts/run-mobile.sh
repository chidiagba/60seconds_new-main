#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${PROJECT_ROOT}"

if command -v adb >/dev/null 2>&1; then
  AUTHORIZED_COUNT="$(adb devices | awk 'NR>1 && $2=="device" {count++} END{print count+0}')"
  UNAUTHORIZED_COUNT="$(adb devices | awk 'NR>1 && $2=="unauthorized" {count++} END{print count+0}')"

  if [[ "${AUTHORIZED_COUNT}" -gt 0 ]]; then
    echo "Authorized Android device found. Starting Android..."
    bash scripts/run-android.sh
    exit 0
  fi

  if [[ "${UNAUTHORIZED_COUNT}" -gt 0 ]]; then
    echo "Android device is connected but unauthorized. Falling back to iOS simulator."
    bash scripts/launch-ios-sim-fast.sh
    exit 0
  fi
fi

echo "No Android device found. Launching iOS simulator..."
bash scripts/launch-ios-sim-fast.sh
