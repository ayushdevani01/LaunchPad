FROM node:20-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /home/app

COPY script.ts script.ts
COPY tsconfig.json tsconfig.json
COPY package*.json ./

RUN npm install

RUN npm run build

RUN chmod +x dist/script.js

ENTRYPOINT [ "/bin/sh", "-c", "if [ -n \"$GITHUB_TOKEN\" ]; then GIT_URL=$(echo $GIT_REPOSITORY__URL | sed \"s|https://|https://x-access-token:$GITHUB_TOKEN@|\"); else GIT_URL=$GIT_REPOSITORY__URL; fi; git clone -b ${BRANCH:-main} \"$GIT_URL\" /home/app/output && exec node dist/script.js" ]
