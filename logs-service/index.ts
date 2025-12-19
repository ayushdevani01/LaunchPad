import 'dotenv/config'
import { Server } from 'socket.io'
import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const SOCKET_PORT = parseInt(process.env.SOCKET_PORT || '9002')

const subscriber = new Redis(REDIS_URL)

const io = new Server(SOCKET_PORT, {
    cors: { origin: '*' }
})

io.on('connection', socket => {
    console.log(`Client connected: ${socket.id}`)

    socket.on('subscribe', (channel: string) => {
        socket.join(channel)
        socket.emit('message', JSON.stringify({ log: `Subscribed to ${channel}` }))
        console.log(`Client ${socket.id} subscribed to ${channel}`)
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

console.log(`Logs Service running on port ${SOCKET_PORT}`)
console.log(`Connected to Redis: ${REDIS_URL}`)
