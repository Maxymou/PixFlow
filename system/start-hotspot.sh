#!/usr/bin/env bash
set -euo pipefail
WLAN_IFACE=${WLAN_IFACE:-wlan0}
SSID=${SSID:-EVENT_WIFI}
PASSPHRASE=${PASSPHRASE:-eventwifi123}

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

cat >/etc/dnsmasq.conf <<CONF
interface=${WLAN_IFACE}
dhcp-range=192.168.4.20,192.168.4.150,255.255.255.0,24h
dhcp-option=3,192.168.4.1
dhcp-option=6,192.168.4.1
address=/#/192.168.4.1
CONF

ip link set ${WLAN_IFACE} down || true
ip addr flush dev ${WLAN_IFACE} || true
ip addr add 192.168.4.1/24 dev ${WLAN_IFACE}
ip link set ${WLAN_IFACE} up

hostapd -B /etc/hostapd/hostapd.conf
dnsmasq -k
