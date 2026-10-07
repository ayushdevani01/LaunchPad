import 'dotenv/config'
import { Server } from 'socket.io'
import Redis from 'ioredis'
import jwt from 'jsonwebtoken'
import mongoose, { Schema } from 'mongoose'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const SOCKET_PORT = parseInt(process.env.SOCKET_PORT || '9002')
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret'
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/launchpad'

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Logs service connected to MongoDB'))
    .catch(err => console.error('Logs service failed to connect to MongoDB:', err))

// Minimal Mongoose model for project verification
interface IProject {
    slug: string
    userId: mongoose.Types.ObjectId
}
const ProjectSchema = new Schema<IProject>({
    slug: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true }
})
const Project = mongoose.model<IProject>('Project', ProjectSchema)
const Deployment = mongoose.model('Deployment', new Schema({
    projectId: Schema.Types.ObjectId,
    createdAt: Date
}))

const subscriber = new Redis(REDIS_URL)
subscriber.on('error', (err: Error) => console.error('Redis subscriber error:', err.message))
// A subscribed Redis connection cannot run history commands.
const history = new Redis(REDIS_URL, {
    connectTimeout: 5000, commandTimeout: 5000, maxRetriesPerRequest: 1,
    enableOfflineQueue: false
})
history.on('error', () => {})

const io = new Server(SOCKET_PORT, {
    cors: { origin: '*' }
})

// Authentication middleware for socket connections
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token
    if (!token) {
        return next(new Error('Authentication error: Token is required'))
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any
        (socket as any).userId = decoded.userId
        next()
    } catch (err) {
        return next(new Error('Authentication error: Invalid token'))
    }
})

io.on('connection', socket => {
    const userId = (socket as any).userId
    console.log(`Authenticated client connected: ${socket.id} (user: ${userId})`)

    let subscriptionVersion = 0
    socket.on('subscribe', async (channel: string) => {
        const version = ++subscriptionVersion
        if (typeof channel !== 'string' || !/^logs:[a-zA-Z0-9_-]+(?::[a-fA-F0-9]{24})?$/.test(channel)) {
            socket.emit('error', 'Invalid log channel')
            return
        }
        const [, projectSlug, requestedDeployment] = channel.split(':')
        
        try {
            // Verify project ownership
            const project = await Project.findOne({ slug: projectSlug })
            if (!project) {
                socket.emit('error', 'Project not found')
                return
            }

            if (project.userId.toString() !== userId) {
                socket.emit('error', 'Unauthorized access to project logs')
                console.log(`Unauthorized subscription attempt by user ${userId} to project ${projectSlug}`)
                return
            }

            // Validate the deployment as well as the project before replaying history.
            const deployment = requestedDeployment
                ? await Deployment.findOne({ _id: requestedDeployment, projectId: project._id })
                : await Deployment.findOne({ projectId: project._id }).sort({ createdAt: -1 })
            if (requestedDeployment && !deployment) {
                socket.emit('error', 'Deployment not found')
                return
            }
            if (version !== subscriptionVersion || !socket.connected) return
            for (const room of socket.rooms) if (room.startsWith('logs:')) await socket.leave(room)
            await socket.join(channel)
            // Join before reading history: concurrent live events can overlap the replay.
            // Event IDs allow clients to merge and deduplicate that overlap.
            if (deployment) {
                try {
                    const entries = await history.lrange(`logs:history:${projectSlug}:${deployment._id}`, 0, -1)
                    if (version === subscriptionVersion && socket.connected) socket.emit('history', entries)
                } catch {
                    socket.emit('log_warning', 'Recent log history is unavailable; live output will continue.')
                }
            }
            if (version !== subscriptionVersion || !socket.connected) return
            socket.emit('subscribed', { channel })
            console.log(`User ${userId} successfully subscribed to logs for: ${projectSlug}`)
        } catch (err) {
            console.error('Subscription error:', err)
            socket.emit('error', 'Internal server error during subscription')
        }
    })

    socket.on('disconnect', () => {
        subscriptionVersion++
        console.log(`Client disconnected: ${socket.id}`)
    })
})

async function initRedisSubscribe() {
    console.log('Subscribing to Redis logs...')

    subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
        io.to(channel).emit('message', message)
    })

    await subscriber.psubscribe('logs:*')
}

// ioredis re-subscribes automatically; ask clients to fill the outage gap.
subscriber.on('ready', () => {
    void subscriber.psubscribe('logs:*')
        .then(() => io.emit('logs:resync'))
        .catch(() => console.error('Redis resubscription failed'))
})
history.on('ready', () => io.emit('logs:resync'))
initRedisSubscribe().catch(() => console.error('Initial Redis subscription failed; reconnecting'))

console.log(`Secure Logs Service running on port ${SOCKET_PORT}`)
console.log('Redis log subscriber configured')
