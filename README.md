# PixFlow Offline Signage

PixFlow is an offline-first digital signage stack with Dockerized backend/frontend services and Raspberry Pi production support.

## Services and profiles
- **backend** (`:4000`) - always enabled.
- **frontend** (`:3000`) - always enabled.
- **player** (Chromium in Docker) - **disabled by default** and now only available through the optional `docker-player` profile.

## Recommended Raspberry Pi PROD architecture
- Docker: `backend`, `frontend`
- Host systemd kiosk: Chromium launcher on Raspberry Pi host (not in Docker)
- Host NetworkManager hotspot helper: `/usr/local/bin/pixflow-hotspot`

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


## Updating PixFlow on Raspberry Pi

To fully update PixFlow on Raspberry Pi (code + Docker + installed kiosk system files):

```bash
cd /home/maxymou/PixFlow
./update.sh
```

`git pull` alone does **not** refresh already-installed host files such as:

- `/etc/systemd/system/pixflow-kiosk.service`
- `/home/maxymou/.xinitrc`

Use kiosk-only mode when you only want to reinstall kiosk system files and restart the service:

```bash
cd /home/maxymou/PixFlow
./update.sh --kiosk-only
```

## Commandes debug depuis l’interface

Le menu Débug peut lancer des actions système prédéfinies :

- Mettre à jour PixFlow
- Relancer le kiosk

Si le redémarrage du kiosk utilise sudo, ajouter une règle sudoers adaptée :

```bash
sudo visudo
```

Exemple :

```txt
maxymou ALL=(root) NOPASSWD: /usr/bin/systemctl restart pixflow-kiosk
```

Ne pas exposer d’exécution de commande libre depuis l’interface.

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

## Video conversion settings (Raspberry Pi friendly)
Backend conversion keeps uploaded videos in MP4 (H.264 Main/Level 4.0 + AAC) with `yuv420p` and `+faststart`.

You can tune conversion limits with environment variables:

```env
VIDEO_MAX_WIDTH=1920
VIDEO_MAX_FPS=30
```

Lower-power mode example:

```env
VIDEO_MAX_WIDTH=1280
VIDEO_MAX_FPS=30
```

After changing these values, remove and re-upload videos you want to reconvert (already converted files are not retroactively re-encoded).


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

If the hotspot does not start, ensure your Raspberry Pi hardware exposes Wi-Fi and that rfkill is unblocked before starting PROD mode.

## Hotspot Wi-Fi

PixFlow utilise NetworkManager via `/usr/local/bin/pixflow-hotspot`.

Ne pas lancer l’ancien service Docker `pixflow-system` en même temps, car il utilise `dnsmasq` sur les ports 53/67 et empêche NetworkManager de démarrer le hotspot.

## Hotspot runtime control (PixFlow settings menu)

The PixFlow settings panel can now temporarily enable/disable the hotspot at runtime via backend API:

- `GET /api/settings` includes:
  - `wifi.hotspotEnabled`
  - `wifi.ethernetConnected`
- `PATCH /api/settings/hotspot` with `{ "enabled": true|false }`

The host helper API (`pixflow-hotspot-api`) listens on port `4876` for localhost and Docker bridge traffic.  
Do **not** publish/expose this port to external networks (router/NAT/public interfaces).

Startup behavior is intentionally fail-safe: PixFlow backend always tries to re-enable hotspot on startup.  
So disabling from the UI is **temporary** and does not persist across Raspberry Pi reboot/app restart.

By default, backend hotspot commands try:

1. `nmcli connection up|down PixFlow-Hotspot` (override with `HOTSPOT_CONNECTION_NAME`)
2. fallback to `systemctl start|stop hostapd dnsmasq` (or `sudo systemctl ...`)

If backend runs as non-root on host, configure minimal sudoers rules (example):

```bash
maxymou ALL=(root) NOPASSWD: /usr/bin/nmcli connection up PixFlow-Hotspot, /usr/bin/nmcli connection down PixFlow-Hotspot
```

## Portail captif PixFlow

En mode Raspberry Pi, PixFlow installe un portail captif local.

Quand un téléphone se connecte au hotspot Wi-Fi PixFlow, iOS/Android/Windows peuvent ouvrir automatiquement une page de connexion au réseau permettant d’accéder à l’administration PixFlow.

Adresse de l’administration :

```txt
http://10.42.0.1:3000
```

Le portail captif repose sur :

- NetworkManager en mode hotspot partagé ;
- dnsmasq lancé par NetworkManager ;
- une configuration DNS installée dans `/etc/NetworkManager/dnsmasq-shared.d/pixflow-captive.conf` ;
- le service `pixflow-captive-portal.service`.

### Vérifications

```bash
/usr/local/bin/pixflow-hotspot status

sudo systemctl status pixflow-hotspot.service --no-pager -l
sudo systemctl status pixflow-hotspot-api.service --no-pager -l
sudo systemctl status pixflow-captive-portal.service --no-pager -l

dig @10.42.0.1 captive.apple.com +short
dig @10.42.0.1 connectivitycheck.gstatic.com +short
dig @10.42.0.1 www.msftconnecttest.com +short
```

Résultat DNS attendu :

```txt
10.42.0.1
10.42.0.1
10.42.0.1
```

Test HTTP :

```bash
curl -i http://127.0.0.1/hotspot-detect.html
curl -i http://127.0.0.1/generate_204
curl -i http://127.0.0.1/
```

Si l’ouverture automatique ne se déclenche pas, ouvrir manuellement :

```txt
http://10.42.0.1:3000
```

### Retour arrière DNS captive

En cas de problème avec le portail captif :

```bash
sudo rm /etc/NetworkManager/dnsmasq-shared.d/pixflow-captive.conf
sudo systemctl restart NetworkManager
sleep 5
sudo /usr/local/bin/pixflow-hotspot ensure
```

## Commandes Débug personnalisables

Le menu **Débug** de PixFlow permet maintenant de personnaliser les boutons (libellé, description, action autorisée) directement depuis l’interface.

- La configuration est enregistrée dans `/data/settings.json`, sous la clé `debugCommands`.
- Seules les actions autorisées par le backend peuvent être exécutées (whitelist stricte).
- Aucune commande shell libre n’est acceptée côté frontend ou backend.
- L’exécution réelle passe uniquement par des commandes prédéfinies côté serveur (`update`, `restart-kiosk`, `reboot-raspberry`, `restart-containers`).

Exemple sudoers (si nécessaire):

```txt
maxymou ALL=(root) NOPASSWD: /usr/bin/systemctl restart pixflow-kiosk, /usr/sbin/reboot
```
