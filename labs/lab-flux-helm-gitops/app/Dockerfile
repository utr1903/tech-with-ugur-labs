FROM node:22.23.2-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3000
USER node
CMD ["npx", "tsx", "src/index.ts"]
