import express from 'express'
import cors from 'cors'
import { loadEnvironment } from './src/lib/environment'
loadEnvironment()

import { connectDB } from './src/lib/db'
import authRoutes from './src/routes/auth'
import projectRoutes from './src/routes/projects'
import { startReconciler } from './src/lib/reconciler'
import { startBuildPublisher } from './src/lib/build-queue'
import { startGitHubEvents } from './src/lib/github-events'
import githubWebhookRoutes from './src/routes/github-webhook'
import githubRoutes from './src/routes/github'
import buildWorkerRoutes from './src/routes/build-worker'
import buildSourceRoutes from './src/routes/build-source'
import mongoose from 'mongoose'
import { Deployment } from './src/models/Deployment'
import { GitHubConnection, GitHubDelivery, GitHubInstallation } from './src/models/GitHubConnection'
import { User } from './src/models/User'


const app = express()
const PORT = process.env.PORT || 9000

const allowedOrigins = [
    'https://launch-pad.dev',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3201',
    'http://127.0.0.1:3201',
];

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://launch-pad.dev'
app.use(cors({
    origin: [FRONTEND_URL, ...allowedOrigins],
    credentials: true,
}))

// Signature verification must see the exact bytes, before JSON parsing.
app.use('/webhooks', githubWebhookRoutes)
app.use(express.json())

app.use('/auth', authRoutes)
app.use('/projects', projectRoutes)
app.use('/github', githubRoutes)
app.use('/internal/builds', buildWorkerRoutes)
app.use('/build-source', buildSourceRoutes)

app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
})

connectDB()
    .then(async () => {
        await Promise.all([Deployment.init(), GitHubConnection.init(), GitHubDelivery.init(), GitHubInstallation.init(), User.init()])
        startReconciler()
        const stopPublisher = startBuildPublisher()
        const stopEvents = startGitHubEvents()
        const server = app.listen(PORT, () => console.log(`API Server running on port ${PORT}`))
        process.once('SIGTERM', () => {
            stopEvents()
            setTimeout(() => process.exit(1), 25000).unref()
            void Promise.all([stopPublisher(), new Promise<void>(resolve => server.close(() => resolve()))])
                .then(() => mongoose.disconnect()).then(() => process.exit(0))
        })
    })
    .catch(() => { console.error('API initialization failed'); process.exit(1) })

