FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends hostapd dnsmasq iproute2 procps rfkill && rm -rf /var/lib/apt/lists/*
COPY start-hotspot.sh /usr/local/bin/start-hotspot.sh
RUN chmod +x /usr/local/bin/start-hotspot.sh
CMD ["/usr/local/bin/start-hotspot.sh"]
