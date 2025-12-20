FROM node:20-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /home/app

COPY script.ts script.ts
COPY tsconfig.json tsconfig.json
COPY package*.json ./

RUN npm install

RUN npm run build

RUN chmod +x dist/script.js

ENTRYPOINT [ "/bin/sh", "-c", "git clone $GIT_REPOSITORY__URL /home/app/output && exec node dist/script.js" ]
