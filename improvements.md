# LaunchPad Platform Improvements (Technical Deep Dive)

After a thorough codebase analysis of the API Server, Build Server, Logs Service, and Reverse Proxy, the following technical improvements have been identified to transition LaunchPad from a basic prototype into a secure, robust, and scalable PaaS.

## 1. Private Repository Support (GitHub Token Storage)
*   **Current State:** The platform successfully uses GitHub OAuth for user login (`auth.ts`), but the `access_token` is discarded after fetching the user profile. Because the token isn't saved to the `User` model, the `build-server/Dockerfile` executes a blind `git clone $GIT_REPOSITORY__URL` which fails for private repositories.
*   **Improvement:** 
    *   Update the `User` model and the `/auth/github/callback` route to securely store the GitHub `access_token`.
    *   Update the `build-server` to accept this `GITHUB_TOKEN` as an environment variable and use it to authenticate `git clone` operations.
    *   Add support for cloning specific branches (e.g., `git clone -b $BRANCH`) rather than defaulting to `main`.

## 2. Database Schema & Deployment History
*   **Current State:** The `Project` model lacks configuration fields. Furthermore, creating a project immediately triggers a Cloud Run job (`jobsClient.runJob`) without creating a historical record.
*   **Improvement:**
    *   **Project Schema:** Add `buildCommand`, `outputDir`, `branch`, `envVars`, and `customDomain`.
    *   **Deployment Model:** Create a new `Deployment` model to track history (e.g., `projectId`, `commitHash`, `status: PENDING | BUILDING | SUCCESS | FAILED`, `logUrl`).
    *   **Status Callback:** The `build-server/script.ts` simply exits `process.exit(0)`. It must be updated to send an HTTP POST request back to the `api-server` to update the `Deployment` status upon completion or failure.

## 3. Build Server Flexibility & Environment Variables
*   **Current State:** The `build-server/script.ts` hardcodes `npm install && npm run build` and blindly checks a list of common output directories (`dist,build,out...`). It does not inject user environment variables.
*   **Improvement:**
    *   **Dynamic Commands:** Modify the `exec()` call in `script.ts` to use `INSTALL_COMMAND` and `BUILD_COMMAND` environment variables provided by the `api-server`.
    *   **Environment Variables:** Pass a JSON payload or prefixed environment variables to the build container so they are available during the Next.js/React build step.

## 4. Single Page Application (SPA) Routing
*   **Current State:** `gcs-reverse-proxy/index.ts` only rewrites the root `/` to `index.html`. If a user deploys a React Router app and visits `/dashboard`, GCS returns a 404.
*   **Improvement:** 
    *   Update the proxy to catch HTTP 404 responses from Google Cloud Storage. If the `Accept` header is `text/html`, rewrite the request to fetch and return the root `index.html` file, allowing client-side routers to handle the path.
    *   Inject `Cache-Control` headers for static assets based on MIME types to optimize Cloudflare edge caching.

## 5. WebSocket Security & Log Persistence
*   **Current State:** `logs-service/index.ts` accepts wildcard CORS and allows anyone to emit `{ "subscribe": "logs:projectSlug" }`. Anyone who guesses a project slug can read private build logs. Furthermore, logs are lost as soon as the build finishes.
*   **Improvement:**
    *   **WebSocket Auth:** Require a JWT token in the socket connection handshake and verify that the user owns the requested `projectSlug`.
    *   **Log Persistence:** Have the `build-server` save the console output to a file and upload it to a `__logs/` directory in GCS alongside the artifacts, making it accessible later via the API.

## 6. Build Job Queueing
*   **Current State:** The API triggers Cloud Run jobs synchronously during the HTTP request. High concurrency will lead to API timeouts, GCP quota exhaustion, or database connection pool limits.
*   **Improvement:**
    *   Implement **BullMQ** (using the existing Redis container).
    *   When a deployment is requested (via API or GitHub Webhook), push a job to the queue. A background worker will manage concurrency limits (e.g., 5 concurrent builds) and trigger the Cloud Run API safely.

## 7. Automated Deployments via Webhooks
*   **Current State:** Deployments only happen on project creation.
*   **Improvement:** 
    *   Add a `POST /api/webhooks/github` route. 
    *   Upon project creation, use the GitHub API to register a push webhook on the repository. The webhook route will verify the GitHub signature, find the corresponding `Project`, create a new `Deployment` record, and queue a new build.

---

## High-Level Architectural & Product Improvements

Beyond the immediate codebase fixes, the following high-level features will elevate LaunchPad to be competitive with platforms like Vercel or Netlify.

### 8. Zero-Downtime Deployments (Atomic Swaps)
*   **Current Architecture:** When a build finishes, it overwrites the files in `__outputs/${PROJECT_ID}/`. If a user visits the site during upload, they might get a mix of old and new files or 404s.
*   **Improvement:** Upload new builds to a directory keyed by a unique `deploymentId` (e.g., `__outputs/${PROJECT_ID}/${DEPLOYMENT_ID}/`). Once the upload is 100% complete, update the `Project` model to point to the new `currentDeploymentId`. The `gcs-reverse-proxy` will then instantly start serving from the new directory, ensuring zero downtime.

### 9. Preview Environments (Pull Requests)
*   **Current Architecture:** There is only one environment per project.
*   **Improvement:** Listen for GitHub `pull_request` webhook events. Deploy the PR code to a temporary URL (e.g., `pr-123-myproject.launch-pad.dev`). Add the URL as a comment on the GitHub PR using the GitHub API. This allows developers to preview changes before merging.

### 10. Instant Rollbacks
*   **Current Architecture:** Reverting to an old version requires finding the old commit and re-deploying (re-running the build).
*   **Improvement:** Since zero-downtime deployments keep previous build folders in GCS, a "Rollback" feature just needs to update the database to point `currentDeploymentId` back to an older directory. Rollbacks happen instantly without running a new build.
