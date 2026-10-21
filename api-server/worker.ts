import { loadEnvironment } from './src/lib/environment'
loadEnvironment()
import { connectDB } from './src/lib/db'
import { kafkaClient, BUILD_TOPIC, BUILD_GROUP, ensureBuildTopic, parseBuildMessage } from './src/lib/build-queue'
import { dispatchBuild } from './src/lib/build-dispatcher'
import { Deployment } from './src/models/Deployment'

async function main() {
    await connectDB()
    await Deployment.init()
    const kafka = kafkaClient('launchpad-deployment-worker')
    await ensureBuildTopic(kafka)
    const consumer = kafka.consumer({ groupId: BUILD_GROUP, sessionTimeout: 60000, heartbeatInterval: 3000 })
    await consumer.connect()
    await consumer.subscribe({ topic: BUILD_TOPIC, fromBeginning: true })
    let stopping = false
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
        stopping = true
        void consumer.stop().then(() => consumer.disconnect()).then(() => process.exit(0))
    })
    await consumer.run({ autoCommit: false, eachMessage: async ({ topic, partition, message, heartbeat }) => {
        let id: string
        try { id = parseBuildMessage(message.value?.toString() || '').deploymentId }
        catch { throw new Error(`Invalid build message at ${topic}/${partition}/${message.offset}; refusing to drop it`) }
        while (!stopping) {
            await heartbeat()
            const outcome = await dispatchBuild(id, heartbeat)
            if (outcome === 'done') {
                await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + BigInt(1)).toString() }])
                return
            }
            // Keep the message uncommitted when capacity is full, an API is
            // unavailable, or another dispatcher still holds its lease.
            for (let i = 0; i < 5 && !stopping; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000))
                await heartbeat()
            }
        }
    } })
}
main().catch(() => { console.error('Deployment worker stopped; Kafka retains uncommitted jobs for restart'); process.exit(1) })
