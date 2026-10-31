FROM mongo:4.4
# макет HA: mongod 4.4 + инструменты управления сетью (tc netem, iptables)
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 iptables ca-certificates && rm -rf /var/lib/apt/lists/*
COPY entry.sh /entry.sh
RUN chmod +x /entry.sh
ENTRYPOINT ["/entry.sh"]
