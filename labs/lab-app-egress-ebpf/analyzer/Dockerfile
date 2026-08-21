FROM node:22.12.0-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src

# Default to producing the report; e2e.sh overrides the command to run verify.
CMD ["npm", "run", "report"]
