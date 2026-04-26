#!/usr/bin/env bash
set -euo pipefail

WLAN_IFACE=${WLAN_IFACE:-wlan0}
SSID=${SSID:-EVENT_WIFI}
PASSPHRASE=${PASSPHRASE:-eventwifi123}

log() {
  echo "[$(date -Iseconds)] [pixflow-system] $*"
}

log "Starting hotspot preflight"
log "Configured interface: ${WLAN_IFACE}"
log "Configured SSID: ${SSID}"

rfkill unblock wifi || true
rfkill unblock all || true

log "rfkill state after unblock attempt:"
rfkill list || true

if ! ip link show "${WLAN_IFACE}" >/dev/null 2>&1; then
  log "Wi-Fi interface ${WLAN_IFACE} not found. Hotspot cannot start."
  exit 1
fi

if ip link show eth0 >/dev/null 2>&1; then
  log "Ethernet interface detected: eth0"
else
  log "Ethernet interface not detected"
fi

log "Writing hostapd configuration"
cat >/etc/hostapd/hostapd.conf <<CONF
interface=${WLAN_IFACE}
ssid=${SSID}
hw_mode=g
channel=6
wmm_enabled=1
auth_algs=1
wpa=2
wpa_passphrase=${PASSPHRASE}
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
CONF

log "Writing dnsmasq configuration"
cat >/etc/dnsmasq.conf <<CONF
interface=${WLAN_IFACE}
dhcp-range=192.168.4.20,192.168.4.150,255.255.255.0,24h
dhcp-option=3,192.168.4.1
dhcp-option=6,192.168.4.1
address=/#/192.168.4.1
CONF

log "Configuring ${WLAN_IFACE} address"
ip link set "${WLAN_IFACE}" down || true
ip addr flush dev "${WLAN_IFACE}" || true
ip addr add 192.168.4.1/24 dev "${WLAN_IFACE}"
ip link set "${WLAN_IFACE}" up

log "Starting hostapd"
hostapd -B /etc/hostapd/hostapd.conf

log "Hotspot startup successful. Launching dnsmasq in foreground"
dnsmasq -k
