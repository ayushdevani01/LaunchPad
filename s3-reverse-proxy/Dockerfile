FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY index.ts app.ts web.ts ./

RUN npm run build && npm prune --omit=dev

EXPOSE 8000

CMD ["node", "dist/index.js"]
