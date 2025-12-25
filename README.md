# LaunchPad

> A distributed frontend deployment platform. Deploy React, Vue, and static sites directly from GitHub with automated builds, live streaming logs, and instant custom subdomains secured by Caddy and Cloudflare. 

![Architecture Diagram](./diagram.png)

---

##  Features

- **One-click deploys** from GitHub repository URLs
- **Real-time build logs** streamed via WebSocket
- **Custom subdomains** for each deployed project (`project-name.launch-pad.dev`)
- **Automatic SSL/TLS** via Cloudflare
- **Edge caching** for fast global delivery
- **Scalable builds** with on-demand Cloud Run containers

---

## System Architecture

### How It Works

```
User → Cloudflare CDN → Caddy (Reverse Proxy) → Services → GCP
```

| Step | Description |
|------|-------------|
| **1** | User submits GitHub URL via frontend |
| **2** | Caddy manages reverse proxy and wildcard SSL|
| **3** | API Server creates project & triggers Cloud Run build job |
| **4** | Build Server clones repo, runs `npm install && npm run build` |
| **5** | Build logs stream to Redis → Logs Service → User via WebSocket |
| **6** | Built assets uploaded to Google Cloud Storage |
| **7** | User visits `project.launch-pad.dev` → GCS Proxy serves files |
| **8** | Cloudflare caches static assets at the edge |

---

## Tech Stack

![Tech Stack](https://go-skill-icons.vercel.app/api/icons?i=nodejs,expressjs,nextjs,docker,gcp,redis,socketio,cloudflare)

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js, React, TypeScript |
| **API Server** | Node.js, Express.js |
| **Real-time** | Socket.io, Redis Pub/Sub |
| **Database** | MongoDB |
| **Build Server** | Docker, Cloud Run Jobs |
| **Storage** | Google Cloud Storage |
| **Gateway** | Caddy (SSL/TLS, Reverse Proxy) |
| **CDN/DNS** | Cloudflare |

---

## Core Services

### API Server
Central control unit managing deployment requests.

Handles:
- User authentication (JWT)
- Project creation & management
- Triggering Cloud Run build jobs
- Communication with MongoDB for persistence

### Build Server (Cloud Run)
Ephemeral Docker containers that:
- Clone GitHub repositories
- Install dependencies & execute build scripts
- Stream logs to Redis in real-time
- Upload production assets to GCS
- Terminate after completion (cost-efficient)

### Logs Service
WebSocket server that:
- Subscribes to Redis Pub/Sub channels
- Streams build logs to connected frontend clients
- Enables real-time deployment progress tracking

### GCS Reverse Proxy 
Routes subdomain requests to GCS storage:
```
my-project.launch-pad.dev → GCS Bucket/my-project/index.html
```
- Extracts subdomain from hostname
- Proxies requests to corresponding GCS folder
- Cloudflare caches responses at edge

---

## Request Flow

### Deployment Flow
```
User → API Server → Cloud Run (Build) → GCS (Upload) → Done
         ↓
       Redis → Logs Service → WebSocket → User (Real-time logs)
```

### Serving Flow (with Cloudflare Caching)
```
User → Cloudflare Edge
         ↓
    [Cache HIT?] → Yes → Return cached file ⚡
         ↓ No
    GCS Proxy → GCS Bucket → Cloudflare (cache) → User
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- Docker
- MongoDB instance
- Redis instance
- GCP account with Cloud Storage & Cloud Run

### Environment Variables

```env
# API Server
MONGODB_URI=mongodb://...
REDIS_URL=redis://...
JWT_SECRET=your-secret
GCP_PROJECT_ID=your-project

# GCS Reverse Proxy
BASE_PATH=https://storage.googleapis.com/your-bucket
```

### Running Locally

```bash
# Start all services with Docker Compose
docker-compose up -d

# Or run individually
cd api-server && npm run dev
cd logs-service && npm run dev
cd gcs-reverse-proxy && npm run dev
```

---

## Project Structure

```
LaunchPad/
├── Frontend/           # Next.js frontend
├── api-server/         # Express API server
├── build-server/       # Cloud Run build container
├── logs-service/       # WebSocket logs server
├── gcs-reverse-proxy/  # Static file proxy
├── docker-compose.yml  # Local development
└── Caddyfile          # Reverse proxy config
```
