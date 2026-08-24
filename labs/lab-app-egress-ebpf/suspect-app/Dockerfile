FROM node:22.12.0-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
# tsx is a runtime dependency here so the dropped helper can execute a .ts file.
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# "Drop" the helper binary: a copy of the Node runtime under an innocent name.
# The app spawns THIS to run the beacon code, so the kernel sensor sees the
# covert traffic coming from `sys-helper`, a child of the main `node` process.
RUN mkdir -p /app/bin && cp "$(command -v node)" /app/bin/sys-helper

ENTRYPOINT ["./entrypoint.sh"]
