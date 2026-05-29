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

if [[ -n "${2:-}" ]]; then
  PACKAGE_NAME="$2"
else
  PACKAGE_NAME="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('${PROJECT_ROOT}/app.json','utf8'));process.stdout.write(p?.expo?.android?.package||'');")"
fi

if [[ -z "$PACKAGE_NAME" ]]; then
  echo "Unable to resolve Android package name from app.json."
  exit 1
fi

echo "Launching ${PACKAGE_NAME} on ${DEVICE_SERIAL}..."
adb -s "$DEVICE_SERIAL" shell monkey -p "$PACKAGE_NAME" -c android.intent.category.LAUNCHER 1

echo "Launch command sent successfully."
