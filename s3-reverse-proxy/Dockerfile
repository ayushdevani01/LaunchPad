FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY index.ts ./

RUN npm run build

EXPOSE 8000

CMD ["node", "dist/index.js"]
