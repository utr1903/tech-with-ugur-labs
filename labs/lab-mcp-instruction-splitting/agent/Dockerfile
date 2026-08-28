FROM node:22.23.2-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
# The fake canary key lives at an absolute path (matches SECRET_DIR=/secret and
# the /secret/id_rsa path the poisoned tool descriptions tell the agent to read).
COPY secret /secret

EXPOSE 3000

CMD ["npm", "start"]
