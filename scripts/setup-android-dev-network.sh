#!/usr/bin/env bash
set -euo pipefail

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. Skipping Android dev network setup."
  exit 0
fi

adb start-server >/dev/null 2>&1 || true

DEVICES=()
UNAUTHORIZED=()
while IFS= read -r serial; do
  if [[ -n "$serial" ]]; then
    DEVICES+=("$serial")
  fi
done < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')

while IFS= read -r serial; do
  if [[ -n "$serial" ]]; then
    UNAUTHORIZED+=("$serial")
  fi
done < <(adb devices | awk 'NR>1 && $2=="unauthorized" {print $1}')

if [[ ${#UNAUTHORIZED[@]} -gt 0 && ${#DEVICES[@]} -eq 0 ]]; then
  echo "Android device connected but unauthorized for USB debugging:"
  for serial in "${UNAUTHORIZED[@]}"; do
    echo "- ${serial}"
  done
  echo "Unlock phone and accept 'Allow USB debugging', then run again."
  exit 1
fi

if [[ ${#DEVICES[@]} -eq 0 ]]; then
  echo "No connected Android devices found for adb reverse."
  exit 0
fi

for serial in "${DEVICES[@]}"; do
  echo "Configuring adb reverse on ${serial}..."
  adb -s "$serial" reverse tcp:8081 tcp:8081 >/dev/null || true
  adb -s "$serial" reverse tcp:19000 tcp:19000 >/dev/null || true
  adb -s "$serial" reverse tcp:19001 tcp:19001 >/dev/null || true
done

echo "Android dev network setup complete."
