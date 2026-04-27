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

cd "$ROOT_DIR"

echo "=============================="
echo " PixFlow update"
echo "=============================="
echo ""

if [ "$KIOSK_ONLY" -eq 0 ]; then
  echo "[1/7] Pull latest code..."
  git pull

  echo "[2/7] Ensure scripts are executable..."
  chmod +x "$ROOT_DIR/install.sh" || true
  chmod +x "$ROOT_DIR/update.sh" || true
  chmod +x "$ROOT_DIR/scripts/"*.sh || true

  echo "[3/7] Rebuild and restart Docker services..."
  if tr -d '\0' </sys/firmware/devicetree/base/model 2>/dev/null | grep -qi "raspberry"; then
    docker compose --profile prod up -d --build
  else
    docker compose up -d --build
  fi
else
  echo "[kiosk-only] Skipping git pull and Docker rebuild."
fi

echo "[4/7] Install kiosk xinitrc..."
sudo install -m 0755 -o "$KIOSK_USER" -g "$KIOSK_USER" "$ROOT_DIR/systemd/xinitrc" "$KIOSK_HOME/.xinitrc"

echo "[5/7] Install systemd kiosk service..."
sudo install -m 0644 "$ROOT_DIR/systemd/pixflow-kiosk.service" /etc/systemd/system/pixflow-kiosk.service
sudo systemctl daemon-reload
sudo systemctl enable pixflow-kiosk

echo "[6/7] Restart kiosk service..."
sudo systemctl restart pixflow-kiosk || true

echo "[6.5/7] Validate installed service entries..."
sudo systemctl cat pixflow-kiosk | grep -E "ExecStart|ExecStartPre|PIXFLOW_KIOSK_URL"

echo "[7/7] Status..."
if [ "$KIOSK_ONLY" -eq 0 ]; then
  docker compose ps
fi
sudo systemctl status pixflow-kiosk --no-pager -l || true

echo ""
echo "PixFlow update complete."
echo "Frontend: http://127.0.0.1:3000/"
echo "Player:   $KIOSK_URL"
echo ""
echo "Logs:"
echo "  docker compose logs -f"
echo "  sudo journalctl -u pixflow-kiosk -f"
