# Raspberry Pi / Debian Trixie kiosk setup

This guide configures PixFlow kiosk mode for Debian Trixie / Raspberry Pi OS Lite using `startx`, so Chromium can run even when no desktop environment is installed.

## Prerequisites

On Debian Trixie / Raspberry Pi OS Trixie, install `chromium` (not `chromium-browser`):

```bash
sudo apt update
sudo apt install -y \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  openbox \
  chromium \
  unclutter \
  curl
```

## Install kiosk files and service

```bash
cd /home/maxymou/PixFlow

cp systemd/xinitrc /home/maxymou/.xinitrc
chmod +x /home/maxymou/.xinitrc

sudo cp systemd/pixflow-kiosk.service /etc/systemd/system/pixflow-kiosk.service
sudo systemctl daemon-reload
sudo systemctl enable pixflow-kiosk
sudo systemctl restart pixflow-kiosk
```

The default URL is `http://127.0.0.1:3000/player`.

## Service verification

```bash
systemctl status pixflow-kiosk --no-pager -l
sudo journalctl -u pixflow-kiosk -n 80 --no-pager
```

## PixFlow verification

```bash
cd /home/maxymou/PixFlow
docker compose ps
curl -I http://127.0.0.1:3000/player
```

## Troubleshooting

### Error: Missing X server or $DISPLAY

Cause: Chromium is started without a running X server.

Fix: use the `pixflow-kiosk.service` service based on `startx`.

### Error: `PixFlow/PixFlow` path in service

Cause: invalid `ExecStart` path.

Fix: recopy the service from this repository:

```bash
sudo cp systemd/pixflow-kiosk.service /etc/systemd/system/pixflow-kiosk.service
sudo systemctl daemon-reload
sudo systemctl restart pixflow-kiosk
```

### Error: Only console users are allowed to run the X server

```bash
sudo nano /etc/X11/Xwrapper.config
```

Content:

```ini
allowed_users=anybody
needs_root_rights=yes
```

Then restart:

```bash
sudo systemctl restart pixflow-kiosk
```


### Kiosk does not start after reboot

The kiosk service waits for the PixFlow frontend before launching Chromium.

Check logs:

```bash
sudo journalctl -u pixflow-kiosk -n 100 --no-pager
```

Check frontend:

```bash
curl -I http://127.0.0.1:3000/player
docker compose ps
```

