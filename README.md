# PixFlow Offline Signage (Raspberry Pi 4)

Production-ready, fully offline digital signage stack with Docker Compose.

## Services
- **frontend**: React + Vite + Tailwind mobile-first management UI (port `3000`)
- **backend**: Node.js 20 + Express REST API + uploads (port `4000`)
- **player**: Chromium kiosk HTML5 signage player (no external port)
- **system**: hostapd + dnsmasq hotspot service (optional but included)

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

## Folder structure
```txt
.
├── backend/
├── frontend/
├── player/
├── system/
├── scripts/
├── docker-compose.yml
└── logo.png
```

## Quick start
```bash
docker compose build
docker compose up -d
```

Then open:
- Admin UI: `http://<pi-ip>:3000`
- API: `http://<pi-ip>:4000`

## API endpoints
- `GET /projects`
- `POST /projects`
- `PATCH /projects/:id/active`
- `GET /media?projectId=<id>`
- `POST /media/upload` (multipart: file, projectId, duration)
- `PATCH /media/:id/active`
- `DELETE /media/:id`
- `GET /playlist`

## Real-time playlist behavior
Any project/media activation or upload triggers immediate regeneration of `/data/playlist.json` and player polling detects changes within 5 seconds, without container restart.

## Player design
- No VLC CLI
- HTML5 rendering for videos/images
- Fullscreen Chromium kiosk
- Smooth fade transition
- Safe fallback when media is empty

## Hotspot mode (offline)
Configured in `system` service:
- SSID: `EVENT_WIFI`
- Gateway: `192.168.4.1`

You can alternatively run host-native setup:
```bash
./scripts/setup-hotspot-host.sh wlan0 EVENT_WIFI eventwifi123
```

## Notes for Raspberry Pi 4 (64-bit)
- Install Raspberry Pi OS Lite 64-bit or Desktop 64-bit.
- Install Docker + Compose plugin.
- If player cannot access X display, run on host once:
  ```bash
  xhost +local:docker
  ```
- For pure headless framebuffer deployments, replace kiosk launch with a Wayland/Weston container profile.
