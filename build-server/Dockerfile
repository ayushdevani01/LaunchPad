FROM node:20-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /home/app

COPY script.ts script.ts
COPY tsconfig.json tsconfig.json
COPY package*.json ./

RUN npm install

RUN npm run build

RUN chmod +x dist/script.js

# ============================================
# ENVIRONMENT VARIABLES
# These are set via Cloud Run Job configuration
# GCP_PROJECT_ID, GCP_SERVICE_ACCOUNT, BUCKET_NAME, REDIS_URL
# are set in the Cloud Run Job definition
#
# Only these 2 are passed per-execution by api-server:
# - CLIENT_PROJECT_ID
# - GIT_REPOSITORY__URL
# ============================================

ENTRYPOINT [ "/bin/sh", "-c", "git clone $GIT_REPOSITORY__URL /home/app/output && exec node dist/script.js" ]
