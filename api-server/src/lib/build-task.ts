import { ECSClient, ListTasksCommand, RunTaskCommand } from '@aws-sdk/client-ecs'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'

const ecs = new ECSClient({ region: process.env.AWS_REGION || 'ap-south-1', maxAttempts: 3 })
let launchQueue: Promise<void> = Promise.resolve()

export async function triggerBuildTask(project: any, deployment: any, githubToken: string) {
    const applicationEnv = project.envVars instanceof Map ? Object.fromEntries(project.envVars) : (project.envVars || {})
    const callbackBase = process.env.BUILD_CALLBACK_BASE_URL || 'https://api.launch-pad.dev'
    const env: Record<string, string> = {
        GIT_REPOSITORY__URL: project.gitUrl, GITHUB_TOKEN: githubToken,
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
    await Project.updateOne({ _id: project._id, $or: [{ latestDeployment: { $exists: false } }, { latestDeployment: null }, { latestDeployment: { $lt: deployment._id } }] }, { $set: { latestDeployment: deployment._id } })
    let failureReason = 'Build task could not start'
    const previous = launchQueue
    let release!: () => void
    launchQueue = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
        const cluster = process.env.AWS_ECS_CLUSTER
        const taskDefinition = process.env.AWS_ECS_TASK_DEFINITION
        const subnets = (process.env.AWS_ECS_SUBNETS || '').split(',').map(s => s.trim()).filter(Boolean)
        const securityGroups = (process.env.AWS_ECS_SECURITY_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean)
        if (!cluster || !taskDefinition || !subnets.length || !securityGroups.length || !env.REDIS_URL) throw new Error('Missing ECS settings')
        const limit = Math.max(1, Math.floor(Number(process.env.BUILD_MAX_CONCURRENT) || 2))
        let count = 0, nextToken: string | undefined
        do {
            const tasks = await ecs.send(new ListTasksCommand({ cluster, desiredStatus: 'RUNNING', maxResults: 100, nextToken }), { abortSignal: AbortSignal.timeout(15000) })
            count += tasks.taskArns?.length || 0
            if (count >= limit) {
                failureReason = 'Build capacity is busy; retry after an active build finishes'
                throw new Error('Build capacity is busy')
            }
            nextToken = tasks.nextToken
        } while (nextToken)
        const overrides = { containerOverrides: [{ name: process.env.AWS_ECS_CONTAINER_NAME || 'build-server', environment: Object.entries(env).map(([name, value]) => ({ name, value })) }] }
        if (Buffer.byteLength(JSON.stringify(overrides), 'utf8') > 8192) {
            failureReason = 'Build settings exceed the ECS task override limit'
            throw new Error('Build settings too large')
        }
        const result = await ecs.send(new RunTaskCommand({
            cluster, taskDefinition, launchType: 'FARGATE', platformVersion: '1.4.0',
            clientToken: deployment._id.toString(), startedBy: `lp-${deployment._id}`,
            networkConfiguration: { awsvpcConfiguration: { subnets, securityGroups, assignPublicIp: 'ENABLED' } },
            tags: [{ key: 'Application', value: 'LaunchPad' }, { key: 'Deployment', value: deployment._id.toString() }],
            overrides
        }), { abortSignal: AbortSignal.timeout(30000) })
        const taskArn = result.tasks?.[0]?.taskArn
        if (!taskArn || result.failures?.length) throw new Error('ECS did not start the build task')
        deployment.taskArn = taskArn
        await deployment.save()
        return taskArn
    } catch {
        await Deployment.updateOne({ _id: deployment._id }, { $set: { status: 'FAILED', failureReason } })
        throw new Error(failureReason)
    } finally { release() }
}
