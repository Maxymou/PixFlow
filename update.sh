#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_USER="${KIOSK_USER:-maxymou}"
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6 || true)"
KIOSK_URL="${PIXFLOW_KIOSK_URL:-http://127.0.0.1:3000/player}"
KIOSK_ONLY=0

usage() {
  cat <<USAGE
Usage: ./update.sh [--kiosk-only]

Options:
  --kiosk-only   Reinstall kiosk files/service only (skip git pull and Docker rebuild)
  -h, --help     Show this help message
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --kiosk-only)
      KIOSK_ONLY=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      usage
      exit 1
      ;;
  esac
done

if [ -z "$KIOSK_HOME" ]; then
  echo "Kiosk user '$KIOSK_USER' not found. Set KIOSK_USER to an existing account."
  exit 1
fi

if [ ! -f "$ROOT_DIR/systemd/xinitrc" ]; then
  echo "Missing file: $ROOT_DIR/systemd/xinitrc"
  exit 1
fi

if [ ! -f "$ROOT_DIR/systemd/pixflow-kiosk.service" ]; then
  echo "Missing file: $ROOT_DIR/systemd/pixflow-kiosk.service"
  exit 1
fi

if [ ! -f "$ROOT_DIR/systemd/pixflow-debug-api.service" ]; then
  echo "Missing file: $ROOT_DIR/systemd/pixflow-debug-api.service"
  exit 1
fi

cd "$ROOT_DIR"

echo "=============================="
echo " PixFlow update"
echo "=============================="
echo ""

if [ "$KIOSK_ONLY" -eq 0 ]; then
  echo "[1/8] Pull latest code..."
  git pull

  echo "[2/8] Ensure scripts are executable..."
  chmod +x "$ROOT_DIR/install.sh" || true
  chmod +x "$ROOT_DIR/update.sh" || true
  chmod +x "$ROOT_DIR/scripts/"*.sh || true

  echo "[3/8] Rebuild and restart Docker services..."
  if tr -d '\0' </sys/firmware/devicetree/base/model 2>/dev/null | grep -qi "raspberry"; then
    docker compose --profile prod up -d --build
  else
    docker compose up -d --build
  fi
else
  echo "[kiosk-only] Skipping git pull and Docker rebuild."
fi

echo "[4/8] Install kiosk xinitrc..."
sudo install -m 0755 -o "$KIOSK_USER" -g "$KIOSK_USER" "$ROOT_DIR/systemd/xinitrc" "$KIOSK_HOME/.xinitrc"

echo "[5/8] Install systemd kiosk and debug-api services..."
sudo install -m 0644 "$ROOT_DIR/systemd/pixflow-kiosk.service" /etc/systemd/system/pixflow-kiosk.service
sudo install -m 0644 "$ROOT_DIR/systemd/pixflow-debug-api.service" /etc/systemd/system/pixflow-debug-api.service
sudo systemctl daemon-reload
sudo systemctl enable pixflow-kiosk
sudo systemctl enable pixflow-debug-api

echo "[6/8] Restart kiosk and debug-api services..."
sudo systemctl restart pixflow-kiosk || true
sudo systemctl restart pixflow-debug-api || true

echo "[7/8] Validate installed service entries..."
sudo systemctl cat pixflow-kiosk | grep -E "ExecStart|ExecStartPre|PIXFLOW_KIOSK_URL"
sudo systemctl cat pixflow-debug-api | grep -E "ExecStart|DEBUG_HOST_API_BIND"

echo "[8/8] Status..."
if [ "$KIOSK_ONLY" -eq 0 ]; then
  docker compose ps
fi
sudo systemctl status pixflow-kiosk --no-pager -l || true
sudo systemctl status pixflow-debug-api --no-pager -l || true

echo ""
echo "PixFlow update complete."
echo "Frontend: http://127.0.0.1:3000/"
echo "Player:   $KIOSK_URL"
echo ""
echo "Logs:"
echo "  docker compose logs -f"
echo "  sudo journalctl -u pixflow-kiosk -f"
echo "  sudo journalctl -u pixflow-debug-api -f"
