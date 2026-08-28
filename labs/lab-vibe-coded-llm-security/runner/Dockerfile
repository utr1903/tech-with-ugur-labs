FROM node:22.23.2-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY e2e ./e2e

CMD ["npm", "run", "e2e"]
