import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs'
import { Deployment } from '../models/Deployment'

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT || undefined,
    credentials: {
        accessKeyId: (process.env.AWS_ACCESS_KEY_ID || 'mock') as string,
        secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || 'mock') as string,
    }
})

const RECONCILE_INTERVAL = 2 * 60 * 1000 // 2 minutes

export function startReconciler() {
    const isMockMode = process.env.MOCK_ECS === 'true' || process.env.AWS_ECS_CLUSTER === 'local'

    if (isMockMode) {
        console.log('Background ECS reconciler SKIPPED (running in MOCK_ECS / local mode).')
        return
    }

    console.log('Background ECS status reconciler initialized.')
    
    setInterval(async () => {
        try {
            // Find all deployments stuck in PENDING or BUILDING
            const activeDeployments = await Deployment.find({
                status: { $in: ['PENDING', 'BUILDING'] },
                taskArn: { $exists: true, $ne: null }
            })

            if (activeDeployments.length === 0) return

            console.log(`[Reconciler] Checking ${activeDeployments.length} active deployments...`)

            const taskArns = activeDeployments.map(d => d.taskArn as string)
            const chunkSize = 100

            for (let i = 0; i < taskArns.length; i += chunkSize) {
                const chunk = taskArns.slice(i, i + chunkSize)
                
                const command = new DescribeTasksCommand({
                    cluster: process.env.AWS_ECS_CLUSTER,
                    tasks: chunk
                })

                const response = await ecsClient.send(command)
                const tasks = response.tasks || []
                
                const taskStatusMap = new Map<string, string>()
                for (const task of tasks) {
                    if (task.taskArn && task.lastStatus) {
                        taskStatusMap.set(task.taskArn, task.lastStatus)
                    }
                }

                const failures = response.failures || []
                const failedTaskArns = new Set<string>()
                for (const f of failures) {
                    if (f.arn) {
                        failedTaskArns.add(f.arn)
                    }
                }

                // Check and update database status
                for (const deployment of activeDeployments) {
                    const arn = deployment.taskArn as string
                    if (!chunk.includes(arn)) continue

                    const ecsStatus = taskStatusMap.get(arn)
                    const isFailedInEcs = failedTaskArns.has(arn)

                    // If task is stopped or completely missing from ECS, mark as FAILED
                    if (ecsStatus === 'STOPPED' || isFailedInEcs) {
                        deployment.status = 'FAILED'
                        await deployment.save()
                        console.log(`[Reconciler] Deployment ${deployment._id} marked as FAILED (ECS task is STOPPED or missing)`)
                    }
                }
            }
        } catch (error) {
            console.error('[Reconciler] Error during ECS task reconciliation:', error)
        }
    }, RECONCILE_INTERVAL)
}
