FROM node:20.18.1-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
EXPOSE 4000
CMD ["npm", "start"]
