#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALL_USER="${SUDO_USER:-$USER}"

echo "=============================="
echo "     PixFlow Installer"
echo "=============================="

# Detect Raspberry Pi
if tr -d '\0' </sys/firmware/devicetree/base/model 2>/dev/null | grep -qi "raspberry"; then
  DEFAULT_MODE="prod"
else
  DEFAULT_MODE="dev"
fi

echo ""
echo "Detected default mode: $DEFAULT_MODE"
echo ""

echo "Select mode:"
echo "1) Dev (server / Proxmox)"
echo "2) Prod (Raspberry Pi)"
echo ""

read -r -p "Your choice [Enter = $DEFAULT_MODE]: " CHOICE

# Interpret choice
if [ "$CHOICE" = "1" ]; then
  MODE="dev"
elif [ "$CHOICE" = "2" ]; then
  MODE="prod"
else
  MODE="$DEFAULT_MODE"
fi

echo ""
echo "Selected mode: $MODE"
echo ""

if [ "$MODE" = "prod" ]; then
  read -r -p "Install Raspberry kiosk display service? [Y/n] " INSTALL_KIOSK
  INSTALL_KIOSK=${INSTALL_KIOSK:-Y}

  sudo apt-get update
  sudo apt-get install -y network-manager
  sudo install -m 755 "$ROOT_DIR/systemd/pixflow-hotspot" /usr/local/bin/pixflow-hotspot

  sudo tee /etc/sudoers.d/pixflow-hotspot >/dev/null <<EOF
${INSTALL_USER} ALL=(root) NOPASSWD: /usr/local/bin/pixflow-hotspot *
EOF
  sudo chmod 440 /etc/sudoers.d/pixflow-hotspot
  sudo visudo -cf /etc/sudoers.d/pixflow-hotspot

  sudo cp "$ROOT_DIR/systemd/pixflow-hotspot.service" /etc/systemd/system/pixflow-hotspot.service
  sudo systemctl daemon-reload
  sudo systemctl enable pixflow-hotspot.service
  sudo systemctl restart pixflow-hotspot.service

  docker compose --profile prod up -d --build

  case "$INSTALL_KIOSK" in
    [Yy]|[Yy][Ee][Ss])
      sudo bash "$ROOT_DIR/scripts/setup-raspberry-kiosk.sh"
      ;;
    *)
      echo "Skipping Raspberry kiosk setup."
      ;;
  esac

  sudo /usr/local/bin/pixflow-hotspot ensure
else
  docker compose up -d --build
fi

echo ""
echo "PixFlow is starting..."
echo ""
