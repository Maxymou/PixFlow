#!/usr/bin/env bash
set -euo pipefail
# Run on Raspberry Pi host if you prefer native hotspot instead of containerized hotspot service.
WLAN_IFACE=${1:-wlan0}
SSID=${2:-EVENT_WIFI}
PASSPHRASE=${3:-eventwifi123}

sudo apt-get update
sudo apt-get install -y hostapd dnsmasq
sudo systemctl unmask hostapd
sudo systemctl disable wpa_supplicant

sudo tee /etc/hostapd/hostapd.conf >/dev/null <<CONF
interface=${WLAN_IFACE}
ssid=${SSID}
hw_mode=g
channel=6
wpa=2
wpa_passphrase=${PASSPHRASE}
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
CONF

sudo tee /etc/dnsmasq.d/pixflow.conf >/dev/null <<CONF
interface=${WLAN_IFACE}
dhcp-range=192.168.4.20,192.168.4.150,255.255.255.0,24h
address=/#/192.168.4.1
CONF

sudo ip addr flush dev ${WLAN_IFACE}
sudo ip addr add 192.168.4.1/24 dev ${WLAN_IFACE}
sudo systemctl restart hostapd
sudo systemctl restart dnsmasq

echo "Hotspot ready: SSID=${SSID}, gateway=192.168.4.1"
