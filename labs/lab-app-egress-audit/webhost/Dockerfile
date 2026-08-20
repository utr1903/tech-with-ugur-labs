FROM python:3.12.7-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 443
ENTRYPOINT ["./entrypoint.sh"]
