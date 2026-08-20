FROM alpine:3.20.3

RUN apk add --no-cache dnsmasq=2.90-r3

COPY dnsmasq.conf /etc/dnsmasq.conf
RUN mkdir -p /var/log/dns

EXPOSE 53/udp 53/tcp
# -k keeps dnsmasq in the foreground so Docker supervises it directly.
CMD ["dnsmasq", "-k", "--conf-file=/etc/dnsmasq.conf"]
