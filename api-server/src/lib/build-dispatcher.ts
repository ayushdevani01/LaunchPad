import axios from 'axios'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'
import { triggerBuildTask, BuildCapacityError, BuildConfigurationError } from './build-task'

export async function dispatchBuild(id: string, heartbeat: () => Promise<void>): Promise<'done' | 'retry'> {
    const existing = await Deployment.findById(id)
    if (!existing || existing.status !== 'PENDING' || existing.taskArn) return 'done'
    const deployment = await Deployment.findOneAndUpdate({ _id: id, status: 'PENDING',
        $or: [{ dispatchLeaseUntil: { $exists: false } }, { dispatchLeaseUntil: { $lt: new Date() } }] },
        { $set: { dispatchLeaseUntil: new Date(Date.now() + 120000) }, $inc: { dispatchAttempts: 1 } },
        { returnDocument: 'after' }).select('+dispatchRequest')
    if (!deployment) return 'retry'
    try {
        if (deployment.dispatchRequest && deployment.createdAt.getTime() < Date.now() - 3600000) {
            throw new BuildConfigurationError('Build launch could not be confirmed within one hour. Check the deployment logs before retrying.')
        }
        const project = await Project.findById(deployment.projectId)
        if (!project) throw new BuildConfigurationError('Project no longer exists')
        let authorization = ''
        if (!deployment.dispatchRequest) {
            const response = await axios.post(`${(process.env.INTERNAL_API_URL || 'http://api-server:9000').replace(/\/$/, '')}/internal/builds/${id}/source`, {},
                { headers: { Authorization: `Bearer ${process.env.WORKER_API_TOKEN || ''}` }, timeout: 20000 })
            authorization = response.data.authorization
            if (!/^[a-f0-9]{64}$/.test(authorization)) throw new Error('Invalid source authorization')
        }
        await triggerBuildTask(project, deployment, authorization, heartbeat)
        return 'done'
    } catch (error: any) {
        if (error instanceof BuildConfigurationError || error.response?.status === 403) {
            await Deployment.updateOne({ _id: id, status: 'PENDING' }, { $set: { status: 'FAILED',
                failureReason: error instanceof BuildConfigurationError ? error.message : 'Reconnect this repository to the LaunchPad GitHub App before deploying.' } })
            return 'done'
        }
        if (!(error instanceof BuildCapacityError)) console.error('Build dispatch temporarily unavailable; retaining queued deployment', id)
        return 'retry'
    } finally {
        await Deployment.updateOne({ _id: id }, { $unset: { dispatchLeaseUntil: 1 } })
    }
}
