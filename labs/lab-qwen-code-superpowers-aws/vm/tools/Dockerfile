# Stage 1: dependencies from the lockfile only.
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Stage 2: the quality gates. `docker build --target test` runs them.
FROM deps AS test
COPY tsconfig.json biome.json knip.json ./
COPY src ./src
RUN npm test && npm run typecheck && npm run lint && npm run knip

# Stage 3: the viewer and verifier image.
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
USER node
ENTRYPOINT ["/app/node_modules/.bin/tsx", "/app/src/index.ts"]
