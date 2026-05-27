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

const subscriber = new Redis(REDIS_URL)

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

    socket.on('subscribe', async (channel: string) => {
        const projectSlug = channel.replace('logs:', '')
        
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

            socket.join(channel)
            socket.emit('message', JSON.stringify({ log: `Subscribed to ${channel}` }))
            console.log(`User ${userId} successfully subscribed to logs for: ${projectSlug}`)
        } catch (err) {
            console.error('Subscription error:', err)
            socket.emit('error', 'Internal server error during subscription')
        }
    })

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`)
    })
})

async function initRedisSubscribe() {
    console.log('Subscribing to Redis logs...')
    subscriber.psubscribe('logs:*')

    subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
        console.log(`[${channel}] ${message}`)
        io.to(channel).emit('message', message)
    })

    subscriber.on('error', (err: Error) => {
        console.error('Redis subscriber error:', err)
    })
}

initRedisSubscribe()

console.log(`Secure Logs Service running on port ${SOCKET_PORT}`)
console.log(`Connected to Redis: ${REDIS_URL}`)
