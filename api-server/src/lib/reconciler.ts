import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs'
import { S3Client } from '@aws-sdk/client-s3'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'
import { publishResult } from './deployment-result'

const region = process.env.AWS_REGION || 'ap-south-1'
const endpoint = process.env.AWS_ENDPOINT || undefined
const ecs = new ECSClient({ region })
const s3 = new S3Client({ region, endpoint, forcePathStyle: !!endpoint, ...(endpoint ? { credentials: { accessKeyId: 'mock', secretAccessKey: 'mock' } } : {}) })
let running = false

export async function reconcileOnce() {
    if (running) return
    running = true
    try {
        const deployments = await Deployment.find({ status: { $in: ['PENDING', 'BUILDING'] }, taskArn: { $exists: true } })
        for (const deployment of deployments) {
            const project = await Project.findById(deployment.projectId)
            if (!project) continue
            try { await publishResult(s3, project, deployment); continue } catch { /* result is not ready */ }
            let stopped = false
            let stopReason = 'Build stopped without a verified deployment result. Check build logs.'
            if (deployment.taskArn?.startsWith('local:')) {
                stopped = true
                stopReason = 'The local build runner was retired. Start a new deployment to use Fargate.'
            } else if (deployment.taskArn) {
                const response = await ecs.send(new DescribeTasksCommand({ cluster: process.env.AWS_ECS_CLUSTER, tasks: [deployment.taskArn] }), { abortSignal: AbortSignal.timeout(15000) })
                stopped = response.tasks?.[0]?.lastStatus === 'STOPPED' || !!response.failures?.length
                const reason = response.tasks?.[0]?.stoppedReason || response.failures?.[0]?.reason
                if (reason) stopReason = `Build task stopped: ${reason}`.slice(0, 512)
            }
            if (stopped) {
                // Exit code zero alone cannot prove a runtime was deployed.
                try { await publishResult(s3, project, deployment) }
                catch { await Deployment.updateOne({ _id: deployment._id, status: { $in: ['PENDING', 'BUILDING'] } }, { $set: { status: 'FAILED', failureReason: stopReason } }) }
            }
        }
    } finally { running = false }
}

export function startReconciler() {
    const timer = setInterval(() => { reconcileOnce().catch(() => console.error('Deployment reconciliation failed')) }, 30000)
    timer.unref()
}
