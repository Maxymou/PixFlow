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

  # Migration: remove legacy containerized hotspot that conflicts with NetworkManager.
  docker compose --profile prod stop system 2>/dev/null || true
  docker compose --profile prod rm -f system 2>/dev/null || true
  docker stop pixflow-system 2>/dev/null || true
  docker rm pixflow-system 2>/dev/null || true
  sudo pkill -f "dnsmasq -k" || true

  sudo install -m 755 "$ROOT_DIR/systemd/pixflow-hotspot" /usr/local/bin/pixflow-hotspot
  sudo install -m 755 "$ROOT_DIR/systemd/pixflow-hotspot-api" /usr/local/bin/pixflow-hotspot-api

  sudo tee /etc/sudoers.d/pixflow-hotspot >/dev/null <<EOF
${INSTALL_USER} ALL=(root) NOPASSWD: /usr/local/bin/pixflow-hotspot *
EOF
  sudo chmod 440 /etc/sudoers.d/pixflow-hotspot
  sudo visudo -cf /etc/sudoers.d/pixflow-hotspot

  sudo cp "$ROOT_DIR/systemd/pixflow-hotspot.service" /etc/systemd/system/pixflow-hotspot.service
  sudo cp "$ROOT_DIR/systemd/pixflow-hotspot-api.service" /etc/systemd/system/pixflow-hotspot-api.service
  sudo systemctl daemon-reload
  sudo systemctl enable pixflow-hotspot.service
  sudo systemctl restart pixflow-hotspot.service
  sudo systemctl enable pixflow-hotspot-api.service
  sudo systemctl restart pixflow-hotspot-api.service

  docker compose up -d --build backend frontend

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
