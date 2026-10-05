FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY index.ts ./

RUN npm run build

EXPOSE 9002

CMD ["node", "dist/index.js"]
