#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="pixflow-kiosk.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
PIXFLOW_KIOSK_URL=${PIXFLOW_KIOSK_URL:-http://localhost:3000/player}
TARGET_USER=${SUDO_USER:-${USER:-$(id -un)}}

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (for example: sudo bash scripts/setup-raspberry-kiosk.sh)."
  exit 1
fi

if ! id "${TARGET_USER}" >/dev/null 2>&1; then
  echo "User ${TARGET_USER} was not found. Unable to configure kiosk service."
  exit 1
fi

TARGET_UID=$(id -u "${TARGET_USER}")
TARGET_HOME=$(getent passwd "${TARGET_USER}" | cut -d: -f6)
if [ -z "${TARGET_HOME}" ]; then
  echo "Unable to determine home directory for ${TARGET_USER}."
  exit 1
fi

echo "Installing Raspberry kiosk dependencies..."
apt-get update
apt-get install -y chromium-browser chromium xserver-xorg xinit openbox unclutter dbus-x11 fonts-dejavu rfkill || \
  apt-get install -y chromium xserver-xorg xinit openbox unclutter dbus-x11 fonts-dejavu rfkill

if command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BIN="$(command -v chromium-browser)"
elif command -v chromium >/dev/null 2>&1; then
  CHROMIUM_BIN="$(command -v chromium)"
else
  echo "Chromium binary not found after package installation."
  exit 1
fi

mkdir -p /usr/local/bin
cat >/usr/local/bin/pixflow-kiosk-launch.sh <<LAUNCH
#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:0
export XDG_RUNTIME_DIR=/run/user/${TARGET_UID}

exec ${CHROMIUM_BIN} \\
  --kiosk \\
  --noerrdialogs \\
  --disable-infobars \\
  --autoplay-policy=no-user-gesture-required \\
  --disable-session-crashed-bubble \\
  --disable-features=TranslateUI \\
  --no-first-run \\
  --disable-restore-session-state \\
  "${PIXFLOW_KIOSK_URL}"
LAUNCH
chmod 755 /usr/local/bin/pixflow-kiosk-launch.sh

cat >"${SERVICE_PATH}" <<SERVICE
[Unit]
Description=PixFlow Chromium Kiosk
After=docker.service network-online.target
Wants=docker.service network-online.target

[Service]
Type=simple
User=${TARGET_USER}
WorkingDirectory=${TARGET_HOME}
Environment=HOME=${TARGET_HOME}
Environment=DISPLAY=:0
Environment=XAUTHORITY=${TARGET_HOME}/.Xauthority
ExecStart=/usr/bin/startx /usr/local/bin/pixflow-kiosk-launch.sh -- :0 -nocursor vt7
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

echo "Reloading systemd and enabling ${SERVICE_NAME}..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Kiosk service installed and started: ${SERVICE_NAME}"
