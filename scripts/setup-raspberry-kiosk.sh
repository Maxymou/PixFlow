#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="pixflow-kiosk.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
TARGET_USER=${SUDO_USER:-${USER:-$(id -un)}}
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (for example: sudo bash scripts/setup-raspberry-kiosk.sh)."
  exit 1
fi

if ! id "${TARGET_USER}" >/dev/null 2>&1; then
  echo "User ${TARGET_USER} was not found. Unable to configure kiosk service."
  exit 1
fi

TARGET_HOME=$(getent passwd "${TARGET_USER}" | cut -d: -f6)
if [ -z "${TARGET_HOME}" ]; then
  echo "Unable to determine home directory for ${TARGET_USER}."
  exit 1
fi

echo "Installing Raspberry kiosk dependencies..."
apt-get update
apt-get install -y x11-xserver-utils unclutter chromium-browser || apt-get install -y x11-xserver-utils unclutter chromium

chmod +x "${REPO_DIR}/scripts/start-kiosk.sh"

cat >"${SERVICE_PATH}" <<SERVICE
[Unit]
Description=PixFlow Chromium Kiosk
After=graphical.target docker.service
Wants=graphical.target

[Service]
Type=simple
User=${TARGET_USER}
Environment=DISPLAY=:0
Environment=XAUTHORITY=${TARGET_HOME}/.Xauthority
Environment=PIXFLOW_KIOSK_URL=http://127.0.0.1:3000/player
ExecStart=${REPO_DIR}/scripts/start-kiosk.sh
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
SERVICE

echo "Reloading systemd and enabling ${SERVICE_NAME}..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Kiosk service installed and started: ${SERVICE_NAME}"
