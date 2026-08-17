FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
CMD ["npm", "start"]
