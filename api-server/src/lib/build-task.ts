import { ECSClient, ListTasksCommand, RunTaskCommand } from '@aws-sdk/client-ecs'
import { Deployment } from '../models/Deployment'

const ecs = new ECSClient({ region: process.env.AWS_REGION || 'ap-south-1', maxAttempts: 3,
    endpoint: process.env.AWS_ECS_ENDPOINT || undefined })
let launchQueue: Promise<void> = Promise.resolve()
export class BuildCapacityError extends Error {}
export class BuildConfigurationError extends Error {}

export async function triggerBuildTask(project: any, deployment: any, sourceAuthorization: string, heartbeat: () => Promise<void> = async () => {}) {
    const applicationEnv = project.envVars instanceof Map ? Object.fromEntries(project.envVars) : (project.envVars || {})
    const callbackBase = process.env.BUILD_CALLBACK_BASE_URL || 'https://api.launch-pad.dev'
    const env: Record<string, string> = {
        GIT_REPOSITORY__URL: project.gitUrl,
        SOURCE_AUTHORIZATION: sourceAuthorization,
        SOURCE_CREDENTIAL_URL: `${callbackBase.replace(/\/$/, '')}/build-source/${deployment._id}`,
        COMMIT_SHA: deployment.commitHash,
        CLIENT_PROJECT_ID: project.slug, DEPLOYMENT_ID: deployment._id.toString(),
        SOURCE_DIR: project.sourceDir || '', INSTALL_COMMAND: project.installCommand || '', BUILD_COMMAND: project.buildCommand || '',
        BUILD_OUTPUT_DIR: project.outputDir || '', DEPLOYMENT_TARGET: project.deploymentTarget || 'auto',
        BRANCH: project.branch || 'main', USER_ENV_VARS: JSON.stringify(applicationEnv),
        AWS_REGION: process.env.AWS_REGION || 'ap-south-1', AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME || '',
        REDIS_URL: process.env.BUILD_REDIS_URL || '',
        API_CALLBACK_URL: `${callbackBase.replace(/\/$/, '')}/projects/${project.slug}/deployments/${deployment._id}/status`,
        LAMBDA_ARCHITECTURE: 'arm64',
        LAMBDA_PERMISSIONS_BOUNDARY_ARN: process.env.LAMBDA_PERMISSIONS_BOUNDARY_ARN || '',
        LAMBDA_RESERVED_CONCURRENCY: process.env.LAMBDA_RESERVED_CONCURRENCY || '',
        AWS_EC2_METADATA_DISABLED: 'true'
    }
    let failureReason = 'Build task could not start'
    const previous = launchQueue
    let release!: () => void
    launchQueue = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
        if (!/^[a-f0-9]{40}$/.test(deployment.commitHash || '')) throw new BuildConfigurationError('A verified source commit is required. Start a new deployment.')
        const cluster = process.env.AWS_ECS_CLUSTER
        const taskDefinition = process.env.AWS_ECS_TASK_DEFINITION
        const subnets = (process.env.AWS_ECS_SUBNETS || '').split(',').map(s => s.trim()).filter(Boolean)
        const securityGroups = (process.env.AWS_ECS_SECURITY_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean)
        if (!cluster || !taskDefinition || !subnets.length || !securityGroups.length || !env.REDIS_URL) throw new BuildConfigurationError('Missing ECS settings')
        const limit = Math.max(1, Math.floor(Number(process.env.BUILD_MAX_CONCURRENT) || 2))
        let count = 0, nextToken: string | undefined
        do {
            await heartbeat()
            const tasks = await ecs.send(new ListTasksCommand({ cluster, desiredStatus: 'RUNNING', maxResults: 100, nextToken }), { abortSignal: AbortSignal.timeout(15000) })
            count += tasks.taskArns?.length || 0
            if (count >= limit) {
                failureReason = 'Build capacity is busy; retry after an active build finishes'
                throw new BuildCapacityError('Build capacity is busy')
            }
            nextToken = tasks.nextToken
        } while (nextToken)
        const overrides = { containerOverrides: [{ name: process.env.AWS_ECS_CONTAINER_NAME || 'build-server', environment: Object.entries(env).map(([name, value]) => ({ name, value })) }] }
        if (Buffer.byteLength(JSON.stringify(overrides), 'utf8') > 8192) {
            failureReason = 'Build settings exceed the ECS task override limit'
            throw new BuildConfigurationError('Build settings exceed the ECS task override limit')
        }
        let request = deployment.dispatchRequest
        if (!request) {
            request = {
                cluster, taskDefinition, launchType: 'FARGATE', platformVersion: '1.4.0',
                clientToken: deployment._id.toString(), startedBy: `lp-${deployment._id}`,
                networkConfiguration: { awsvpcConfiguration: { subnets, securityGroups, assignPublicIp: 'ENABLED' } },
                tags: [{ key: 'Application', value: 'LaunchPad' }, { key: 'Deployment', value: deployment._id.toString() }], overrides
            }
            // Reuse the exact ECS request after an uncertain SDK response. The
            // client token alone is insufficient if credentials/settings change.
            await Deployment.updateOne({ _id: deployment._id }, { $set: { dispatchRequest: request } })
            deployment.dispatchRequest = request
        }
        await heartbeat()
        const result = await ecs.send(new RunTaskCommand(request), { abortSignal: AbortSignal.timeout(30000) })
        const taskArn = result.tasks?.[0]?.taskArn
        if (!taskArn || result.failures?.length) throw new Error('ECS did not start the build task')
        await Deployment.updateOne({ _id: deployment._id, status: 'PENDING' }, { $set: { taskArn, status: 'BUILDING' }, $unset: { dispatchLeaseUntil: 1 } })
        return taskArn
    } catch (error) {
        if (error instanceof BuildCapacityError || error instanceof BuildConfigurationError) throw error
        // Do not turn temporary AWS errors into a lost build. Kafka retains the
        // message, and the dispatcher retries the persisted idempotent request.
        throw new Error(failureReason)
    } finally { release() }
}
