import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'

const getAwsEndpoint = (): string | undefined => {
    const ep = process.env.AWS_ENDPOINT
    if (!ep) return undefined
    const trimmed = ep.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') {
        return undefined
    }
    try {
        new URL(trimmed)
        return trimmed
    } catch (e) {
        console.warn(`[AWS_ENDPOINT] Ignoring invalid AWS_ENDPOINT URL in reconciler: "${trimmed}"`)
        return undefined
    }
}

const awsEndpoint = getAwsEndpoint()

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: awsEndpoint,
    credentials: {
        accessKeyId: (process.env.AWS_ACCESS_KEY_ID || 'mock') as string,
        secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || 'mock') as string,
    }
})

const RECONCILE_INTERVAL = 2 * 60 * 1000

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

                    const task = tasks.find(t => t.taskArn === arn)
                    const ecsStatus = task?.lastStatus
                    const isFailedInEcs = failedTaskArns.has(arn)

                    if (ecsStatus === 'STOPPED') {
                        const buildContainerName = process.env.AWS_ECS_CONTAINER_NAME || 'build-server'
                        const buildContainer = task?.containers?.find(c => c.name === buildContainerName)
                        const exitCode = buildContainer?.exitCode

                        if (exitCode === 0) {
                            deployment.status = 'SUCCESS'
                            await deployment.save()

                            const project = await Project.findById(deployment.projectId)
                            if (project) {
                                project.currentDeployment = deployment._id
                                await project.save()
                            }
                            console.log(`[Reconciler] Deployment ${deployment._id} marked as SUCCESS (ECS task stopped with exit code 0)`)
                        } else {
                            deployment.status = 'FAILED'
                            await deployment.save()
                            console.log(`[Reconciler] Deployment ${deployment._id} marked as FAILED (ECS task stopped with exit code ${exitCode})`)
                        }
                    } else if (isFailedInEcs) {
                        deployment.status = 'FAILED'
                        await deployment.save()
                        console.log(`[Reconciler] Deployment ${deployment._id} marked as FAILED (ECS task is missing or failed in ECS)`)
                    }
                }
            }
        } catch (error) {
            console.error('[Reconciler] Error during ECS task reconciliation:', error)
        }
    }, RECONCILE_INTERVAL)
}
