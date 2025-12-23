# Launchpad

Launchpad is a Vercel-like platform that simplifies application deployment. It enables users to deploy projects directly from GitHub URLs, automating the build and hosting process.

## System Overview

The platform consists of several interconnected components that handle the lifecycle of a deployment, from code retrieval to serving static assets.


## Tech Stack

![Tech Stack](https://go-skill-icons.vercel.app/api/icons?i=nodejs,expressjs,nextjs,docker,nginx,ecs,ecr,s3,redis,socketio,cloudflare)

*   Node.js
*   Express
*   Next js
*   Docker
*   AWS ECS (Fargate)
*   AWS ECR
*   AWS S3
*   nginx
*   Redis
*   Socket.io

### Usage Flow

1.  **Project Submission**: A user submits a GitHub repository URL to the API Server.
2.  **Build Trigger**: The API Server orchestrates a new build by launching a dedicated container within the Build Server cluster.
3.  **Building & Processing**: The assigned container clones the repository, installs necessary dependencies, and executes the build script.
4.  **Asset Storage**: Upon successful completion, the build artifacts (HTML, CSS, JS) are uploaded to an S3 bucket for persistent storage.
5.  **Live Access**: Users can access their deployed applications via custom subdomains. A Reverse Proxy intercepts these requests and serves the corresponding files directly from S3.

## Core Services

### API Server
The central control unit built with Node.js and Express. It manages incoming deployment requests, spins up containerized build tasks on AWS ECS, and coordinates real-time communication. It utilizes a Socket.io server to stream build logs back to the user interface, keeping them informed of the deployment progress. Redis is used as a message broker for these logs.

### Build Server
A scalable fleet of ephemeral Docker containers managed by AWS ECS. Each deployment triggers a new container that handles the specific build requirements of the submitted project. These containers push the final production-ready assets to an S3 bucket and then terminate, ensuring efficient resource usage.

### Reverse Proxy
A specialized service that routes incoming HTTP requests to the appropriate S3 storage location. It resolves subdomains (e.g., project-name.localhost) to the specific project folder in the S3 bucket, delivering the correct index.html and assets to the end-user.
