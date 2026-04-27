#!/usr/bin/env bash
set -euo pipefail

URL="${PIXFLOW_KIOSK_URL:-http://127.0.0.1:3000/player}"
TIMEOUT_SECONDS="${PIXFLOW_WAIT_TIMEOUT_SECONDS:-120}"
SLEEP_SECONDS="${PIXFLOW_WAIT_SLEEP_SECONDS:-2}"

echo "Waiting for PixFlow frontend at: $URL"

start_ts="$(date +%s)"

while true; do
  if curl -fsI "$URL" >/dev/null 2>&1 || curl -fs "$URL" >/dev/null 2>&1; then
    echo "PixFlow frontend is ready."
    exit 0
  fi

  now_ts="$(date +%s)"
  elapsed="$((now_ts - start_ts))"

  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    echo "Timed out waiting for PixFlow frontend after ${TIMEOUT_SECONDS}s: $URL"
    exit 1
  fi

  echo "PixFlow not ready yet (${elapsed}s/${TIMEOUT_SECONDS}s). Retrying..."
  sleep "$SLEEP_SECONDS"
done
