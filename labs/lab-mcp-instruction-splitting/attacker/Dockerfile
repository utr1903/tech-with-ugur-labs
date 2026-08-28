FROM node:22.23.2-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src

EXPOSE 9000

CMD ["npm", "start"]
