#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"

# Disable screensaver / DPMS / blanking
xset s off || true
xset -dpms || true
xset s noblank || true

# Hide mouse cursor if unclutter exists
command -v unclutter >/dev/null 2>&1 && unclutter -idle 0.5 -root &

CHROMIUM_BIN="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "${CHROMIUM_BIN}" ]; then
  echo "chromium-browser/chromium not found"
  exit 1
fi

exec "${CHROMIUM_BIN}" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  "${PIXFLOW_KIOSK_URL:-http://127.0.0.1:3000/player}"
