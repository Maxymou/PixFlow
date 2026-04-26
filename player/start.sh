#!/usr/bin/env bash
set -euo pipefail
node /app/server.js &
sleep 2
chromium \
  --no-sandbox \
  --disable-setuid-sandbox \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  http://localhost:4100
