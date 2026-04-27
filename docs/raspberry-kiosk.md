# Raspberry Pi kiosk setup

This guide configures PixFlow to launch Chromium directly on the player route and keeps the screen awake.

## Prerequisites

Run on Raspberry Pi OS:

```bash
sudo apt update
sudo apt install -y x11-xserver-utils unclutter chromium-browser
```

If `chromium-browser` is unavailable on your image:

```bash
sudo apt install -y chromium
```

## Install kiosk launcher and service

From the PixFlow repository root:

```bash
chmod +x scripts/start-kiosk.sh
sudo cp systemd/pixflow-kiosk.service /etc/systemd/system/pixflow-kiosk.service
sudo systemctl daemon-reload
sudo systemctl enable pixflow-kiosk
sudo systemctl restart pixflow-kiosk
```

The default URL is `http://127.0.0.1:3000/player`.

## Optional automated setup script

You can also run:

```bash
sudo bash scripts/setup-raspberry-kiosk.sh
```

## Debug commands

```bash
systemctl status pixflow-kiosk
journalctl -u pixflow-kiosk -f
```
