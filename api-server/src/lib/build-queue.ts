import { Kafka, logLevel, Producer } from 'kafkajs'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'

export const BUILD_TOPIC = process.env.KAFKA_BUILD_TOPIC || 'launchpad.deployments'
export const BUILD_GROUP = 'launchpad-build-dispatcher-v1'

export function kafkaClient(clientId: string) {
    const brokers = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',').map(value => value.trim()).filter(Boolean)
    return new Kafka({ clientId, brokers, logLevel: logLevel.ERROR, connectionTimeout: 10000, requestTimeout: 30000,
        retry: { retries: 5 }, ssl: process.env.KAFKA_TLS === 'true',
        ...(process.env.KAFKA_USERNAME ? { sasl: { mechanism: 'scram-sha-512' as const,
            username: process.env.KAFKA_USERNAME, password: process.env.KAFKA_PASSWORD || '' } } : {}) })
}

export async function ensureBuildTopic(kafka: Kafka) {
    const admin = kafka.admin()
    await admin.connect()
    try {
        await admin.createTopics({ waitForLeaders: true, topics: [{ topic: BUILD_TOPIC, numPartitions: 1, replicationFactor: 1,
            configEntries: [{ name: 'retention.ms', value: '604800000' }, { name: 'cleanup.policy', value: 'delete' }] }] })
        const metadata = await admin.fetchTopicMetadata({ topics: [BUILD_TOPIC] })
        // One active dispatcher owns the global Fargate capacity check. Scaling
        // this topic needs a distributed capacity allocator before adding partitions.
        if (metadata.topics[0]?.partitions.length !== 1) throw new Error('The build topic must have exactly one partition')
    } finally { await admin.disconnect() }
}

export type BuildMessage = { version: 1; deploymentId: string }
export function parseBuildMessage(value: string): BuildMessage {
    const data = JSON.parse(value)
    if (data.version !== 1 || !/^[a-f0-9]{24}$/.test(data.deploymentId || '') ||
        Object.keys(data).some(key => !['version', 'deploymentId'].includes(key))) throw new Error('Invalid build message')
    return data
}

export async function enqueueDeployment(project: any, commitHash: string, trigger: 'manual' | 'push' = 'manual') {
    if (!/^[a-f0-9]{40}$/.test(commitHash)) throw new Error('A verified source commit is required')
    let deployment
    try { deployment = await Deployment.create({ projectId: project._id, status: 'PENDING', commitHash, trigger }) }
    catch (err: any) {
        if (trigger !== 'push' || err.code !== 11000) throw err
        deployment = await Deployment.findOne({ projectId: project._id, commitHash, trigger })
    }
    if (!deployment) throw new Error('Deployment could not be queued')
    await Project.updateOne({ _id: project._id, $or: [{ latestDeployment: { $exists: false } },
        { latestDeployment: null }, { latestDeployment: { $lt: deployment._id } }] }, { $set: { latestDeployment: deployment._id } })
    // The deployment itself is the durable outbox. A Kafka outage must not lose
    // an accepted request, and an uncertain send can safely be repeated.
    return deployment
}

export async function publishPending(producer: Producer) {
    for (let count = 0; count < 100; count++) {
        const now = new Date()
        const deployment = await Deployment.findOneAndUpdate({ status: 'PENDING',
            $and: [{ $or: [{ queuePublishedAt: { $exists: false } }, { queuePublishedAt: { $lt: new Date(Date.now() - 600000) } }] },
                { $or: [{ queueLeaseUntil: { $exists: false } }, { queueLeaseUntil: { $lt: now } }] }] },
            { $set: { queueLeaseUntil: new Date(Date.now() + 60000) } }, { sort: { _id: 1 }, returnDocument: 'after' })
        if (!deployment) return
        await Project.updateOne({ _id: deployment.projectId, $or: [{ latestDeployment: { $exists: false } },
            { latestDeployment: null }, { latestDeployment: { $lt: deployment._id } }] }, { $set: { latestDeployment: deployment._id } })
        await producer.send({ topic: BUILD_TOPIC, acks: -1, messages: [{ key: deployment.projectId.toString(),
            value: JSON.stringify({ version: 1, deploymentId: deployment._id.toString() }) }] })
        await Deployment.updateOne({ _id: deployment._id }, { $set: { queuePublishedAt: new Date() }, $unset: { queueLeaseUntil: 1 } })
    }
}

export function startBuildPublisher() {
    let stopping = false
    const kafka = kafkaClient('launchpad-api-producer')
    const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 })
    const delay = () => new Promise(resolve => { const timer = setTimeout(resolve, 2000); timer.unref() })
    const run = async () => {
        while (!stopping) {
            try {
                await ensureBuildTopic(kafka)
                await producer.connect()
                while (!stopping) { await publishPending(producer); await delay() }
            } catch { console.error('Build queue unavailable; pending deployments remain in the durable outbox'); await delay() }
        }
    }
    void run()
    return async () => { stopping = true; await producer.disconnect() }
}
