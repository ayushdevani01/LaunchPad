FROM node:20-slim

# Install docker CLI only when INSTALL_DOCKER build arg is set (for local dev simulation)
ARG INSTALL_DOCKER=false
RUN if [ "$INSTALL_DOCKER" = "true" ]; then \
        apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY index.ts ./
COPY src ./src

RUN npm run build

EXPOSE 9000

CMD ["node", "dist/index.js"]
