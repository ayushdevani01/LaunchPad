# LaunchPad

> A distributed deployment platform. Deploy static sites, Next.js applications, and Node.js backends directly from GitHub with automated builds, live streaming logs, and custom HTTPS subdomains.

![Architecture Diagram](./architecture.png)

---

## Features

- **GitHub sign-in** with access to only the repositories you select
- **Framework detection** after choosing a repository, branch, and source folder
- **Static and server deployments** using private S3 storage and native AWS Lambda Web Functions
- **Automatic redeploys** when a push matches the project's branch and source folder
- **Real-time build logs** including dependency installation, compilation, upload, and health checks
- **Deployment history** with archived logs and the previous healthy deployment kept live after a failed build
- **GitHub deployment reporting** with build status, live URLs, and links to logs
- **Custom subdomains** for each project (`project-name.launch-pad.dev`)
- **Wildcard SSL/TLS** issued and renewed by Caddy through Cloudflare DNS verification
- **On-demand builds** using ephemeral AWS ECS Fargate tasks

---

## System Architecture

### How It Works

```text
Developer / GitHub push -> API Server -> Kafka -> Deployment Worker -> ECS Fargate
                                                                        |
                                                        Build -> S3 / Web Function

Website Visitor -> Cloudflare -> Caddy -> Application Proxy -> S3 / Web Function
```

| Step | Description |
|------|-------------|
| **1** | User signs in with GitHub, connects selected repositories, and chooses a branch and source folder |
| **2** | A manual deployment or a verified GitHub push creates a deployment record in MongoDB |
| **3** | The API's publisher sends the deployment ID from the durable outbox to Kafka |
| **4** | The deployment worker consumes the job and starts an ECS Fargate build task |
| **5** | The Go build service clones the exact commit, installs dependencies, and builds the application |
| **6** | Build output streams through Redis -> Logs Service -> Dashboard using Socket.IO |
| **7** | Static assets are uploaded to S3; server applications are packaged into a Lambda Web Function |
| **8** | The API verifies the private build result and promotes the deployment after the required checks pass |
| **9** | Visitors reach the project subdomain through Cloudflare, Caddy, and the application proxy |
| **10** | Deployment status, the live URL, and log links are reported back to GitHub |

The API, deployment worker, Kafka, MongoDB, Redis, logs service, application proxy, and Caddy run on one VM through Docker Compose. Build containers run separately on Fargate. Deployed application servers run on Lambda Web Functions.

---

## Supported Projects

| Project | Hosting | Build Output / Start Command |
|---------|---------|------------------------------|
| **React, Vue, Svelte with Vite** | S3 | `dist` |
| **Create React App** | S3 | `build` |
| **Angular** | S3 | Select the generated folder, such as `dist/app/browser` |
| **Astro static sites** | S3 | `dist` |
| **Static HTML** | S3 | The source folder containing `index.html` |
| **Next.js static export** | S3 | `out`, with `output: 'export'` configured |
| **Next.js with SSR, API routes, or Server Actions** | Lambda Web Function + S3 | Managed standalone build; hashed assets under `/_next/static/` go to S3 |
| **Express, Hono, Fastify, Koa, NestJS, plain Node.js** | Lambda Web Function | A production command such as `node server.js` or `node dist/main.js` |

### Frontend and Backend Routing

A static React application is served entirely from S3. Browser interactivity and client-side routing do not require a Web Function.

An Express-only or other Node.js backend sends every path and HTTP method to its Web Function. The application can define routes such as `/users`, `/health`, or `/api/hello`.

Frontend and backend applications can also be separate projects, each with its own subdomain. Point the frontend's API base URL at the backend project and configure CORS in the backend to allow the frontend's origin.

For a Node.js project with a static frontend, configure its frontend output folder. The proxy serves frontend GET/HEAD requests from S3 and keeps `/api` and `/api/...` on the Web Function:

```text
my-app.launch-pad.dev/            -> S3 frontend
my-app.launch-pad.dev/dashboard   -> S3 frontend / SPA fallback
my-app.launch-pad.dev/api/hello   -> Node.js Web Function
```

Next.js uses one project hostname for both pages and backend routes. Only `/_next/static/` assets are routed to S3; pages, API routes, Server Actions, public files, and image optimization reach the Next.js server.

### Current Scope

- Web Function packages use **Node.js 24 on Linux ARM64**. Compiled applications need a production Node entry point.
- Angular's output directory may need to be selected manually because its generated browser files are nested.
- Next.js cache files are local to each runtime instance. Shared cache and tag invalidation across instances are not implemented.
- Nuxt SSR and Remix are not supported deployment targets in the current detector.

---

## Tech Stack

![Tech Stack](https://go-skill-icons.vercel.app/api/icons?i=go,nodejs,expressjs,nextjs,docker,aws,redis,socketio,cloudflare)

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js, React, TypeScript, Tailwind CSS, Framer Motion |
| **API Server** | Node.js, Express, TypeScript, JWT |
| **Build Queue** | Apache Kafka, MongoDB deployment outbox |
| **Deployment Worker** | Node.js, Kafka consumer, AWS ECS SDK |
| **Build Server** | Go, Node.js build tools, Docker, AWS ECS Fargate |
| **Application Runtime** | AWS Lambda Web Functions, Node.js 24, ARM64 |
| **Real-time Logs** | Socket.IO, Redis Pub/Sub |
| **Database** | MongoDB |
| **Storage** | Private Amazon S3 |
| **Runtime Logs** | Amazon CloudWatch |
| **Gateway** | Caddy, wildcard certificates, Cloudflare DNS challenge |
| **CDN / DNS** | Cloudflare |
| **Container Images** | Amazon ECR |
| **VM Services** | Docker Compose |

---

## Core Services

### API Server

Central service managing accounts, projects, and deployment state.

Handles:

- GitHub sign-in and selected repository access
- Branch and folder browsing, framework detection, and build settings
- Signed GitHub webhooks and branch/source-folder matching
- Durable deployment records and Kafka publication
- Build-result verification, live deployment promotion, and GitHub reporting

### Deployment Worker

Consumes deployment IDs from Kafka and starts Fargate tasks.

- Loads project settings and checks available build capacity
- Obtains a one-use authorization for repository checkout
- Retries transient failures without dropping the queued job
- Uses a persisted ECS request and idempotency token to avoid duplicate task launches

Compose currently allows **two concurrent build tasks**. Additional builds wait in the queue. This build limit is separate from application request concurrency.

### Build Server (ECS Fargate)

An ephemeral container running the Go build service:

- Clones the exact source commit and selects the configured application folder
- Runs dependency installation and build commands with streamed output
- Selects a static, Next.js, or Node.js adapter
- Uploads versioned static assets and packages server code
- Creates the Web Function and checks its HTTP readiness when a server is required
- Archives build logs, persists the result, and calls back to the API
- Exits after the job finishes

The service is organized into `handler`, `service`, `adapter`, and `repository` packages. Framework-specific build and packaging behavior lives in the adapters.

### Logs Service

Authenticated Socket.IO server that:

- Verifies project ownership before allowing subscriptions
- Subscribes to Redis Pub/Sub and replays recent log history
- Streams install, build, upload, and deployment output to the dashboard

Completed build logs are archived in S3. Application runtime logs are separate and go to CloudWatch.

### Application Reverse Proxy

Resolves each subdomain to its active deployment using MongoDB.

- Streams static files from the private S3 bucket
- Resolves generated `/page.html` and `/page/index.html` files before SPA fallback
- Forwards Node.js and Next.js requests over HTTPS to the Web Function
- Signs runtime requests with AWS Signature Version 4 for IAM authentication
- Preserves request methods, bodies, application authorization, cookies, and streamed responses

Static objects are stored under a versioned deployment prefix:

```text
__outputs/<project>/<deployment-id>/...
```

### Caddy and Cloudflare

Cloudflare handles DNS, edge HTTPS, and cacheable static responses. Caddy handles HTTPS at the VM and routes requests by hostname:

| Hostname | Destination |
|----------|-------------|
| `api.<base-domain>` | API Server |
| `logs.<base-domain>` | Logs Service |
| `<project>.<base-domain>` | Application Reverse Proxy |

Caddy obtains and renews wildcard certificates through the **Cloudflare DNS-01 challenge**. The Cloudflare token is supplied only to Caddy.

---

## Request Flow

### Deployment Flow

```text
Dashboard: deploy                 GitHub: push to configured branch
        |                                      |
        +------------- API Server <------------+
                            |
                    MongoDB deployment outbox
                            |
                          Kafka
                            |
                    Deployment Worker
                            |
                    ECS Fargate build task
                       /           \
                  Private S3    Web Function
                       \           /
                    Verify result + health
                            |
                    Promote live deployment
```

GitHub sends push webhooks to the API, which verifies the signature and evaluates the project's auto-deploy settings. GitHub does not publish directly to Kafka.

### Build Log Flow

```text
Build stdout / stderr -> Redis -> Logs Service -> Socket.IO -> Dashboard
         |
         +------------> S3 build log archive
```

### Serving Flow

```text
Visitor -> Cloudflare -> Caddy -> Application Proxy
                                      |
                              Find active deployment
                                  /          \
                           Static request   Server request
                                  |                |
                             Private S3      Web Function
```

Cacheable static responses can be served from Cloudflare's edge. A build switches traffic only after its result is verified. A failed build keeps the previous healthy deployment live.

---

## Getting Started

### Prerequisites

- A Linux host with Docker Engine and Docker Compose v2
- A domain managed through Cloudflare
- Existing AWS resources for S3, ECS Fargate, ECR, IAM, and Lambda Web Functions
- A GitHub App for sign-in, selected repository access, and push events
- Node.js 24 for local development and Go 1.26+ when working on the build service
- AWS CLI and Docker Buildx when publishing the build worker image

### AWS Resources

Compose starts the VM services. Supply the following AWS resources through the root `.env`:

- A **private S3 bucket** for static output, runtime packages, results, and archived logs
- An **ECR repository** named `launchpad-build-worker`
- An **ECS cluster and Linux ARM64 Fargate task definition**, using the worker image and a container named `build-server`
- An **ECS execution role** for image pulls and build-task logging
- A **build task role** allowed to use the artifact bucket, manage Web Functions, and pass the runtime execution role
- A **Web Function execution role** trusted by Lambda, with application log permissions
- AWS credentials for the VM services, including ECS dispatch, S3 access, Web Function invocation, and the required role-passing permissions

The artifact bucket must permit Lambda to retrieve the runtime packages. Include access to object versions when bucket versioning is enabled.

Fargate must be able to reach the API callback endpoint and the configured Redis address. Bind Redis to the host's private interface and restrict port `6379` to the build task's security group.

### Environment Variables

For a fresh installation, copy the root template and fill in its values:

```bash
cp .env.example .env
```

Keep the existing `.env` when updating an installation. The template contains the complete setting list.

| Settings | Purpose |
|----------|---------|
| `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD`, `REDIS_PASSWORD` | Credentials for the Compose data services |
| `JWT_SECRET`, `WORKER_API_TOKEN` | Dashboard sessions and internal worker authentication |
| `AWS_REGION`, `AWS_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | AWS region, artifact bucket, and VM credentials |
| `AWS_SESSION_TOKEN` | Required when using temporary AWS credentials |
| `LAMBDA_WEB_ROLE_ARN` | Existing Web Function execution role |
| `AWS_ECS_CLUSTER`, `AWS_ECS_TASK_DEFINITION`, `AWS_ECS_SUBNETS`, `AWS_ECS_SECURITY_GROUPS` | Fargate build placement |
| `BUILD_REDIS_BIND_IP`, `BUILD_REDIS_URL` | Private Redis interface and Fargate-reachable connection URL |
| `BASE_DOMAIN`, `CF_API_TOKEN` | Project domain and scoped Cloudflare DNS token |
| `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET` | GitHub App credentials and callbacks |
| `FRONTEND_URL` | Dashboard URL used by authentication redirects and deployment log links |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_LOGS_URL` | Public API and Socket.IO endpoints used by the dashboard |

Compose supplies internal MongoDB, Redis, and Kafka addresses to its services. The Fargate build task uses its AWS task role; VM access keys and the Cloudflare token are not copied into its task overrides.

### GitHub App Setup

From the API directory:

```bash
cd api-server
npm ci
npm run github:setup
```

Open `http://127.0.0.1:3101` and review the app registration in GitHub. The helper saves generated credentials to the ignored root `.env` and `.secrets/github-app.pem`.

The app uses:

| Permission | Access |
|------------|--------|
| **Email addresses** | Read-only for sign-in |
| **Repository contents and metadata** | Read-only on selected repositories |
| **Deployments** | Read/write for deployment statuses and URLs |
| **Push events** | Signed webhooks to the API |

Install the app using **Only select repositories**. Its webhook is `https://api.<base-domain>/webhooks/github`, and its sign-in callback is `https://api.<base-domain>/auth/github-app/callback`.

### Publish the Build Worker

Authenticate an AWS CLI profile, then run the helper from the repository root in PowerShell:

```powershell
.\scripts\push-build-server.ps1 -Profile Launchpad -Region ap-south-1
```

The script builds the Linux ARM64 image and pushes it to ECR. New Fargate tasks pull the updated `latest` image.

### Run the VM Stack

Point the wildcard DNS record `*.<base-domain>` at the VM. Allow inbound ports `80` and `443`, and give Caddy a Cloudflare token with **Zone Read** and **DNS Edit** permissions restricted to that zone.

From the repository root:

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

MongoDB, Redis, and Kafka use persistent Docker volumes. `scripts/mongo-init.js` creates the application database user on MongoDB's first startup.

### Frontend

The public website and dashboard are in **`Frontend`**:

```bash
cd Frontend
npm ci
npm run dev
```

Open `http://localhost:3000`. The frontend reads the shared root environment file. For real local sign-in, the API's `FRONTEND_URL` must point to the local dashboard, and the public API/logs URLs must reach the running services.

For frontend hosting, set the project's Root Directory to **`Frontend`**, configure its public API/logs environment values, and use `npm run build`. Set the API's `FRONTEND_URL` to that hosted dashboard URL.

To explore the UI locally without GitHub or AWS:

```bash
cd Frontend
npm run preview
```

Open `http://127.0.0.1:3201`. This uses an in-memory preview API, sample projects, and simulated build logs. It does not create real deployments.

---

## Testing

After installing dependencies in the Node.js services, run from the repository root:

```bash
npm --prefix api-server test
npm --prefix s3-reverse-proxy test
npm --prefix Frontend test
npm --prefix Frontend run typecheck
```

For the Go build service:

```bash
cd build-server
go test ./...
```

Live deployment checks have covered 15 application cases: Angular, React/Vite, Vue, Svelte, Create React App, Astro, static HTML, Next.js SSR/API, Next.js static export, Express, Hono, Fastify, Koa, NestJS, and plain Node.js. These checks used small applications and included private repository builds, static navigation, browser interactions, backend authentication, and JSON requests.

---

## Project Structure

```text
LaunchPad/
├── Frontend/                    # Public website, dashboard, deployment wizard
├── api-server/                  # API, GitHub integration, Kafka publisher and worker
├── build-server/                # Go build service and Fargate worker image
│   ├── cmd/build-server/        # Worker entry point
│   └── internal/
│       ├── adapter/             # Static, Next.js and Node.js packaging
│       ├── config/              # Build job settings
│       ├── domain/              # Shared build types and interfaces
│       ├── handler/             # Job setup and execution
│       ├── repository/          # Git, S3, Web Functions, processes and logs
│       └── service/             # Build lifecycle
├── logs-service/                # Authenticated live build log streaming
├── s3-reverse-proxy/            # Static file and Web Function routing
├── caddy/                       # Caddy image with Cloudflare DNS support
├── scripts/
│   ├── mongo-init.js            # First-start database user setup
│   └── push-build-server.ps1    # Build and publish the worker image
├── .env.example                 # Shared configuration template
├── docker-compose.yml           # VM services and persistent volumes
├── Caddyfile                    # Wildcard TLS and hostname routing
└── architecture.png             # Architecture diagram
```
