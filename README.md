# PixFlow Offline Signage

PixFlow is an offline-first digital signage stack with Dockerized backend/frontend services and Raspberry Pi production support.

## Services and profiles
- **backend** (`:4000`) - always enabled.
- **frontend** (`:3000`) - always enabled.
- **system** (hotspot helper) - enabled by Docker `prod` profile.
- **player** (Chromium in Docker) - **disabled by default** and now only available through the optional `docker-player` profile.

## Recommended Raspberry Pi PROD architecture
- Docker: `backend`, `frontend`, `system` (`--profile prod`)
- Host systemd kiosk: Chromium launcher on Raspberry Pi host (not in Docker)

This avoids X11/display issues on Raspberry Pi OS Lite where no desktop session exists inside containers.

## Recommended OS
- Raspberry Pi OS Lite 64-bit

## Raspberry Pi installation (PROD)
```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo reboot
```

After reboot:

```bash
git clone https://github.com/Maxymou/PixFlow.git
cd PixFlow
chmod +x install.sh
./install.sh
```

Choose:
- `2) Prod (Raspberry Pi)`
- optionally `Install Raspberry kiosk display service? [Y/n]`

In PROD mode:
- admin/dashboard is available at `http://<raspberry-ip>:3000/`
- kiosk/player is available at `http://<raspberry-ip>:3000/player`
- backend is available at `http://<raspberry-ip>:4000`
- kiosk service runs on the Raspberry Pi host via `pixflow-kiosk.service` and opens `/player` by default
- Docker player is disabled by default because Raspberry Pi OS Lite has no X server inside Docker

You can override the default host kiosk URL before running the setup script:

```bash
export PIXFLOW_KIOSK_URL=http://localhost:3000/player
sudo bash scripts/setup-raspberry-kiosk.sh
```

## DEV installation (Proxmox / server)
```bash
chmod +x install.sh
./install.sh
```

Choose:
- `1) Dev (server / Proxmox)`

DEV mode starts only `frontend` + `backend`.

## Optional Docker player
If you explicitly want the previous containerized player:

```bash
docker compose --profile docker-player up -d --build
```

## Data layout (persistent volume)
```txt
/data/
  incoming/
  media/
  projects/
    projects.json
    media.json
  playlist.json
```

## Troubleshooting

### Check containers
```bash
docker ps
docker compose logs -f
```

### Check kiosk service
```bash
systemctl status pixflow-kiosk
journalctl -u pixflow-kiosk -f
```

### Check Wi-Fi/rfkill state
```bash
rfkill list
ip link
sudo rfkill unblock wifi
```

If the hotspot container reports that `wlan0` is missing, ensure your Raspberry Pi hardware exposes Wi-Fi and that rfkill is unblocked before starting PROD mode.
