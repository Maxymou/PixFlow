#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="pixflow-kiosk.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
TARGET_USER=${SUDO_USER:-${USER:-$(id -un)}}
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_TEMPLATE="${REPO_DIR}/systemd/pixflow-kiosk.service"
XINITRC_TEMPLATE="${REPO_DIR}/systemd/xinitrc"

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

if [ ! -f "${SERVICE_TEMPLATE}" ]; then
  echo "Missing service template: ${SERVICE_TEMPLATE}"
  exit 1
fi

if [ ! -f "${XINITRC_TEMPLATE}" ]; then
  echo "Missing xinitrc template: ${XINITRC_TEMPLATE}"
  exit 1
fi

echo "Installing Raspberry kiosk dependencies..."
apt-get update
apt-get install -y \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  openbox \
  chromium \
  unclutter \
  curl || apt-get install -y \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  openbox \
  chromium-browser \
  unclutter \
  curl

echo "Ensuring repository scripts are executable..."
chmod +x "${REPO_DIR}/scripts/"*.sh || true

echo "Installing kiosk xinitrc from template..."
install -m 0755 -o "${TARGET_USER}" -g "${TARGET_USER}" "${XINITRC_TEMPLATE}" "${TARGET_HOME}/.xinitrc"

echo "Installing kiosk systemd service from template..."
sed \
  -e "s|^User=.*|User=${TARGET_USER}|" \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=${REPO_DIR}|" \
  -e "s|/home/maxymou/.xinitrc|${TARGET_HOME}/.xinitrc|" \
  "${SERVICE_TEMPLATE}" > "${SERVICE_PATH}"
chmod 0644 "${SERVICE_PATH}"

echo "Reloading systemd and enabling ${SERVICE_NAME}..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Installed service entries:"
systemctl cat "${SERVICE_NAME}" | grep -E "ExecStart|ExecStartPre|PIXFLOW_KIOSK_URL" || true

echo "Kiosk service installed and started: ${SERVICE_NAME}"
