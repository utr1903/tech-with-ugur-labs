FROM node:22.23.2-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY secret ./secret

EXPOSE 3000

CMD ["npm", "start"]
