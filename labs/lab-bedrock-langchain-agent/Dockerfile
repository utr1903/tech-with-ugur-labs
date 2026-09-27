# Stage 1: install dependencies from the lockfile only.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Stage 2: the image that runs the app, the tests and the e2e script.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json tsconfig.json biome.json knip.json vitest.config.ts drizzle.config.ts ./
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node src ./src
COPY --chown=node:node e2e ./e2e
EXPOSE 3000
CMD ["npm", "run", "--silent", "start"]
