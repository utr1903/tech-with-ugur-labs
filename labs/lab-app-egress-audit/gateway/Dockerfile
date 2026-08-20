FROM mitmproxy/mitmproxy:11.1.3

USER root
RUN apt-get update && apt-get install -y --no-install-recommends iptables procps \
    && rm -rf /var/lib/apt/lists/*

COPY capture.py /addon/capture.py
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
