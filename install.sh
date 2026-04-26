#!/usr/bin/env bash
set -e

echo "=============================="
echo "     PixFlow Installer"
echo "=============================="

# Detect Raspberry Pi
if cat /sys/firmware/devicetree/base/model 2>/dev/null | grep -qi "raspberry"; then
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

read -p "Your choice [Enter = $DEFAULT_MODE]: " CHOICE

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

# Launch Docker
if [ "$MODE" = "prod" ]; then
  docker compose --profile prod up -d --build
else
  docker compose up -d --build
fi

echo ""
echo "PixFlow is starting..."
echo ""
