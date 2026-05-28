import { Router, Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { Project } from '../models/Project'
import { User } from '../models/User'
import { Deployment } from '../models/Deployment'
import { authMiddleware } from '../middleware/auth'
import axios from 'axios'
import { exec } from 'child_process'

const router = Router()

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT || undefined,
    credentials: {
        accessKeyId: (process.env.AWS_ACCESS_KEY_ID || 'mock') as string,
        secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || 'mock') as string,
    }
})

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT || undefined,
    forcePathStyle: process.env.AWS_ENDPOINT ? true : undefined,
    credentials: {
        accessKeyId: (process.env.AWS_ACCESS_KEY_ID || 'mock') as string,
        secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || 'mock') as string,
    }
})

async function triggerBuildTask(project: any, deployment: any, githubToken: string) {
    const gitURL = project.gitUrl
    const projectSlug = project.slug
    const normalizedSourceDir = project.sourceDir || ''
    const installCommand = project.installCommand || ''
    const buildCommand = project.buildCommand || ''
    const outputDir = project.outputDir || ''
    const branch = project.branch || 'main'
    const envVars = project.envVars || {}

    const internalCallback = process.env.INTERNAL_API_URL 
        ? `${process.env.INTERNAL_API_URL}/projects/${projectSlug}/deployments/${deployment._id.toString()}/status`
        : `http://api-server:9000/projects/${projectSlug}/deployments/${deployment._id.toString()}/status`

    if (process.env.MOCK_ECS === 'true' || process.env.AWS_ECS_CLUSTER === 'local') {
        const dockerCmd = `docker run -d \
            --network ${process.env.DOCKER_NETWORK || 'launchpad-network'} \
            -e GIT_REPOSITORY__URL="${gitURL}" \
            -e GITHUB_TOKEN="${githubToken}" \
            -e CLIENT_PROJECT_ID="${projectSlug}" \
            -e DEPLOYMENT_ID="${deployment._id.toString()}" \
            -e REDIS_URL="${process.env.REDIS_URL || 'redis://redis:6379'}" \
            -e SOURCE_DIR="${normalizedSourceDir}" \
            -e INSTALL_COMMAND="${installCommand}" \
            -e BUILD_COMMAND="${buildCommand}" \
            -e BUILD_OUTPUT_DIR="${outputDir}" \
            -e BRANCH="${branch}" \
            -e USER_ENV_VARS='${JSON.stringify(envVars)}' \
            -e AWS_REGION="${process.env.AWS_REGION || 'us-east-1'}" \
            -e AWS_ACCESS_KEY_ID="${process.env.AWS_ACCESS_KEY_ID || 'mock'}" \
            -e AWS_SECRET_ACCESS_KEY="${process.env.AWS_SECRET_ACCESS_KEY || 'mock'}" \
            -e AWS_BUCKET_NAME="${process.env.AWS_BUCKET_NAME || 'launchpad-assets'}" \
            -e AWS_ENDPOINT="${process.env.AWS_ENDPOINT || 'http://localstack:4566'}" \
            -e API_CALLBACK_URL="${internalCallback}" \
            ayushdevani01/launchpad-build-server:latest`

        console.log(`[MOCK ECS] Spawning local docker build container: ${dockerCmd}`)
        exec(dockerCmd, (err, stdout, stderr) => {
            if (err) {
                console.error('[MOCK ECS] Failed to start docker container:', err)
                console.error('[MOCK ECS] Stderr:', stderr)
            } else {
                console.log('[MOCK ECS] Container started with ID:', stdout.trim())
            }
        })

        const executionName = `arn:aws:ecs:local:task/${deployment._id}`
        deployment.taskArn = executionName
        await deployment.save()
        return executionName
    }

    const command = new RunTaskCommand({
        cluster: process.env.AWS_ECS_CLUSTER,
        taskDefinition: process.env.AWS_ECS_TASK_DEFINITION,
        launchType: 'FARGATE',
        networkConfiguration: {
            awsvpcConfiguration: {
                subnets: (process.env.AWS_ECS_SUBNETS || '').split(','),
                securityGroups: (process.env.AWS_ECS_SECURITY_GROUPS || '').split(','),
                assignPublicIp: 'ENABLED',
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: process.env.AWS_ECS_CONTAINER_NAME || 'build-server',
                    environment: [
                        { name: 'GIT_REPOSITORY__URL', value: gitURL },
                        { name: 'GITHUB_TOKEN', value: githubToken },
                        { name: 'CLIENT_PROJECT_ID', value: projectSlug },
                        { name: 'DEPLOYMENT_ID', value: deployment._id.toString() },
                        { name: 'REDIS_URL', value: process.env.REDIS_URL as string },
                        { name: 'SOURCE_DIR', value: normalizedSourceDir },
                        { name: 'INSTALL_COMMAND', value: installCommand },
                        { name: 'BUILD_COMMAND', value: buildCommand },
                        { name: 'BUILD_OUTPUT_DIR', value: outputDir },
                        { name: 'BRANCH', value: branch },
                        { name: 'USER_ENV_VARS', value: JSON.stringify(envVars) },
                        { name: 'AWS_REGION', value: process.env.AWS_REGION as string },
                        { name: 'AWS_ACCESS_KEY_ID', value: process.env.AWS_ACCESS_KEY_ID as string },
                        { name: 'AWS_SECRET_ACCESS_KEY', value: process.env.AWS_SECRET_ACCESS_KEY as string },
                        { name: 'AWS_BUCKET_NAME', value: process.env.AWS_BUCKET_NAME as string },
                        { name: 'AWS_ENDPOINT', value: process.env.AWS_ENDPOINT || '' },
                        { name: 'API_CALLBACK_URL', value: internalCallback }
                    ]
                }
            ]
        }
    })

    const response = await ecsClient.send(command)
    const executionName = response.tasks?.[0]?.taskArn || 'unknown'

    if (executionName !== 'unknown') {
        deployment.taskArn = executionName
        await deployment.save()
    }
    return executionName
}

// Framework Auto-Detector Helper
async function detectFramework(owner: string, repo: string, pathStr: string, branch: string, token: string) {
    const headers = {
        Authorization: `token ${token}`,
        'User-Agent': 'LaunchPad-App',
        Accept: 'application/vnd.github.v3.raw'
    }

    try {
        const packageJsonUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathStr ? pathStr + '/' : ''}package.json?ref=${branch}`
        const { data: packageJsonStr } = await axios.get(packageJsonUrl, { headers })
        const pkg = typeof packageJsonStr === 'object' ? packageJsonStr : JSON.parse(packageJsonStr)

        const deps = { ...pkg.dependencies, ...pkg.devDependencies }

        // 1. Next.js
        if (deps['next']) {
            try {
                const configNames = ['next.config.js', 'next.config.mjs', 'next.config.ts']
                let hasStaticExport = false
                for (const name of configNames) {
                    try {
                        const configUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathStr ? pathStr + '/' : ''}${name}?ref=${branch}`
                        const { data: configContent } = await axios.get(configUrl, { headers })
                        const contentStr = typeof configContent === 'string' ? configContent : JSON.stringify(configContent)
                        if (contentStr.includes("output: 'export'") || contentStr.includes('output: "export"')) {
                            hasStaticExport = true
                            break
                        }
                    } catch (e) {}
                }

                if (hasStaticExport) {
                    return {
                        framework: 'Next.js (Static Export)',
                        supported: 'YES',
                        installCommand: 'npm install',
                        buildCommand: 'npm run build',
                        outputDir: 'out',
                        notes: 'Next.js static export is fully supported.'
                    }
                } else {
                    return {
                        framework: 'Next.js (SSR)',
                        supported: 'NO',
                        notes: 'Next.js SSR/App Router requires a Node.js server. Only Next.js with output: "export" config is supported.'
                    }
                }
            } catch (e) {
                return {
                    framework: 'Next.js (SSR)',
                    supported: 'NO',
                    notes: 'Next.js SSR/App router requires a Node.js server. Please enable static export in next.config.js.'
                }
            }
        }

        // 2. Vite (React, Vue, Svelte, etc.)
        if (deps['vite']) {
            return {
                framework: 'Vite Project',
                supported: 'YES',
                installCommand: 'npm install',
                buildCommand: 'npm run build',
                outputDir: 'dist',
                notes: 'Vite projects are fully supported.'
            }
        }

        // 3. Create React App
        if (deps['react-scripts']) {
            return {
                framework: 'Create React App',
                supported: 'YES',
                installCommand: 'npm install',
                buildCommand: 'npm run build',
                outputDir: 'build',
                notes: 'Create React App projects are fully supported.'
            }
        }

        // 4. Astro
        if (deps['astro']) {
            return {
                framework: 'Astro (Static)',
                supported: 'YES',
                installCommand: 'npm install',
                buildCommand: 'npm run build',
                outputDir: 'dist',
                notes: 'Astro static site generation is fully supported.'
            }
        }

        // 5. Angular
        if (deps['@angular/core']) {
            return {
                framework: 'Angular',
                supported: 'PARTIAL',
                installCommand: 'npm install',
                buildCommand: 'npm run build',
                outputDir: 'dist',
                notes: 'Angular builds output files to nested directories like dist/<project-name>/browser. Please specify the nested folder in the output directory if needed.'
            }
        }

        // 6. Nuxt
        if (deps['nuxt']) {
            return {
                framework: 'Nuxt (SSR)',
                supported: 'NO',
                notes: 'Nuxt SSR requires a server. Only static Nuxt generation (generating output directory) is supported.'
            }
        }

        // 7. Remix
        if (deps['@remix-run/react']) {
            return {
                framework: 'Remix',
                supported: 'NO',
                notes: 'Remix requires a Node.js runtime environment and cannot be hosted statically.'
            }
        }

        return {
            framework: 'Custom Node.js Project',
            supported: 'PARTIAL',
            installCommand: 'npm install',
            buildCommand: 'npm run build',
            outputDir: 'dist',
            notes: 'Node project detected. Ensure it builds static HTML/JS/CSS assets.'
        }

    } catch (err: any) {
        // Check for static HTML fallback
        if (err.response?.status === 404) {
            try {
                const indexUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathStr ? pathStr + '/' : ''}index.html?ref=${branch}`
                await axios.get(indexUrl, { headers })
                return {
                    framework: 'Static HTML',
                    supported: 'YES',
                    installCommand: '',
                    buildCommand: '',
                    outputDir: '',
                    notes: 'Static HTML pages are fully supported.'
                }
            } catch (e) {
                return {
                    framework: 'Unknown Project',
                    supported: 'NO',
                    notes: 'No package.json or index.html found. We only support Node.js static frameworks or plain HTML websites.'
                }
            }
        }
        throw err
    }
}

// =========================================================================
// PUBLIC CALLBACK ROUTE (Called by Build Server container upon exit)
// =========================================================================
router.post('/:slug/deployments/:deploymentId/status', async (req: Request, res: Response) => {
    const { slug, deploymentId } = req.params
    const { status } = req.body

    if (!['SUCCESS', 'FAILED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' })
    }

    try {
        const project = await Project.findOne({ slug })
        if (!project) {
            return res.status(404).json({ error: 'Project not found' })
        }

        const deployment = await Deployment.findOne({ _id: deploymentId, projectId: project._id })
        if (!deployment) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        deployment.status = status
        await deployment.save()

        if (status === 'SUCCESS') {
            project.currentDeployment = deployment._id
            await project.save()
        }

        console.log(`[CALLBACK] Project ${slug} deployment ${deploymentId} set to ${status}`)
        return res.json({ success: true })
    } catch (error) {
        console.error('[CALLBACK] Failed to update status:', error)
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// =========================================================================
// GITHUB WEBHOOK RECEIVER ROUTE (Public)
// =========================================================================
router.post('/webhook/github', async (req: Request, res: Response) => {
    const event = req.headers['x-github-event']
    if (event !== 'push') {
        return res.status(200).json({ message: 'Event ignored' })
    }

    const { repository, ref, commits } = req.body
    if (!repository || !ref || !commits || commits.length === 0) {
        return res.status(400).json({ error: 'Invalid webhook payload' })
    }

    // Get repository clone URL and branch
    const gitUrl = repository.html_url
    const branchName = ref.replace('refs/heads/', '')

    try {
        // Find all projects watching this repository and branch
        const projects = await Project.find({ gitUrl, branch: branchName })
        if (projects.length === 0) {
            console.log(`[WEBHOOK] No projects found matching gitUrl: ${gitUrl}, branch: ${branchName}`)
            return res.status(200).json({ message: 'No matching projects found' })
        }

        for (const project of projects) {
            console.log(`[WEBHOOK] Triggering automated deployment for project: ${project.slug}`)

            // Get the user's github token to clone private repos if necessary
            const user = await User.findById(project.userId)
            const githubToken = user?.githubToken || ''

            // Create a new deployment
            const deployment = await Deployment.create({
                projectId: project._id,
                status: 'BUILDING'
            })

            // Trigger the build task run
            await triggerBuildTask(project, deployment, githubToken)
        }

        return res.status(200).json({ success: true, message: `Deployments triggered for ${projects.length} project(s)` })
    } catch (error) {
        console.error('[WEBHOOK] Failed to process webhook:', error)
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// =========================================================================
// AUTHENTICATED USER ROUTES
// =========================================================================
router.use(authMiddleware)

router.get('/github/repos', async (req: Request, res: Response) => {
    const userId = res.locals.authUser.userId
    try {
        const user = await User.findById(userId)
        if (!user || !user.githubToken) {
            return res.status(400).json({ error: 'GitHub account not linked. Please login via GitHub.' })
        }

        const { data } = await axios.get('https://api.github.com/user/repos?per_page=100&sort=updated', {
            headers: {
                Authorization: `token ${user.githubToken}`,
                'User-Agent': 'LaunchPad-App'
            }
        })

        const repos = data.map((repo: any) => ({
            name: repo.name,
            fullName: repo.full_name,
            gitUrl: repo.clone_url,
            private: repo.private,
            defaultBranch: repo.default_branch
        }))

        return res.json({ repos })
    } catch (err: any) {
        console.error('Failed to fetch github repos:', err.response?.data || err.message)
        return res.status(500).json({ error: 'Failed to fetch repositories' })
    }
})

router.get('/github/branches', async (req: Request, res: Response) => {
    const { owner, repo } = req.query
    const userId = res.locals.authUser.userId

    if (!owner || !repo) {
        return res.status(400).json({ error: 'owner and repo are required' })
    }

    try {
        const user = await User.findById(userId)
        if (!user || !user.githubToken) {
            return res.status(400).json({ error: 'GitHub account not linked.' })
        }

        const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches`, {
            headers: {
                Authorization: `token ${user.githubToken}`,
                'User-Agent': 'LaunchPad-App'
            }
        })

        const branches = data.map((b: any) => b.name)
        return res.json({ branches })
    } catch (err: any) {
        console.error('Failed to fetch branches:', err.response?.data || err.message)
        return res.status(500).json({ error: 'Failed to fetch branches' })
    }
})

router.get('/github/detect', async (req: Request, res: Response) => {
    const { owner, repo, path = '', branch = 'main' } = req.query
    const userId = res.locals.authUser.userId

    if (!owner || !repo) {
        return res.status(400).json({ error: 'owner and repo are required' })
    }

    try {
        const user = await User.findById(userId)
        if (!user || !user.githubToken) {
            return res.status(400).json({ error: 'GitHub account not linked.' })
        }

        const result = await detectFramework(
            owner as string,
            repo as string,
            path as string,
            branch as string,
            user.githubToken
        )

        return res.json({ detection: result })
    } catch (err: any) {
        console.error('Failed to detect framework:', err.response?.data || err.message)
        return res.status(500).json({ error: 'Failed to analyze repository contents' })
    }
})

router.post('/', async (req: Request, res: Response) => {
    const { 
        gitURL, 
        project_name, 
        sourceDir,
        buildCommand,
        installCommand,
        outputDir,
        branch,
        envVars
    } = req.body
    const userId = res.locals.authUser.userId

    if (!gitURL) {
        return res.status(400).json({ error: 'gitURL is required' })
    }

    const githubRegex = /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i
    if (!githubRegex.test(gitURL)) {
        return res.status(400).json({ error: 'Only GitHub repository URLs are supported' })
    }

    const normalizedSourceDir = sourceDir?.trim().replace(/^\/+|\/+$/g, '') || ''
    const projectSlug = project_name?.trim() || generateSlug()

    try {
        const existing = await Project.findOne({ slug: projectSlug })
        if (existing) {
            return res.status(400).json({ error: 'Project name already taken' })
        }

        const user = await User.findById(userId)
        const githubToken = user?.githubToken || ''

        const project = await Project.create({
            slug: projectSlug,
            gitUrl: gitURL,
            sourceDir: normalizedSourceDir || undefined,
            userId: userId,
            buildCommand: buildCommand?.trim() || undefined,
            installCommand: installCommand?.trim() || undefined,
            outputDir: outputDir?.trim() || undefined,
            branch: branch?.trim() || 'main',
            envVars
        })

        const deployment = await Deployment.create({
            projectId: project._id,
            status: 'BUILDING'
        })

        // Register Webhook on GitHub Repository automatically using the OAuth Token
        if (githubToken) {
            const gitMatch = gitURL.match(/github\.com\/([^/]+)\/([^/.]+)/i)
            if (gitMatch) {
                const owner = gitMatch[1]
                const repo = gitMatch[2]

                // Construct public webhook URL
                const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')
                const host = req.get('host')
                const webhookUrl = `${protocol}://${host}/projects/webhook/github`

                console.log(`[WEBHOOK REGISTRATION] Registering webhook for ${owner}/${repo} pointing to ${webhookUrl}`)
                try {
                    const response = await axios.post(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
                        name: 'web',
                        active: true,
                        events: ['push'],
                        config: {
                            url: webhookUrl,
                            content_type: 'json',
                            insecure_ssl: '0'
                        }
                    }, {
                        headers: {
                            'Authorization': `Bearer ${githubToken}`,
                            'Accept': 'application/vnd.github+json',
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    })
                    console.log(`[WEBHOOK REGISTRATION] GitHub Webhook registered successfully. ID: ${response.data.id}`)
                } catch (webhookError: any) {
                    if (webhookError.response && webhookError.response.status === 422) {
                        console.log(`[WEBHOOK REGISTRATION] Webhook already exists for ${owner}/${repo}`)
                    } else {
                        console.error(`[WEBHOOK REGISTRATION] Failed to register webhook:`, webhookError.response?.data || webhookError.message)
                    }
                }
            }
        }

        // Trigger build container/task
        const executionName = await triggerBuildTask(project, deployment, githubToken)

        console.log(`Build started for project: ${projectSlug}, deployment: ${deployment._id}`)

        return res.json({
            data: {
                projectSlug,
                url: `https://${projectSlug}.launch-pad.dev`,
                executionName,
                project,
                deployment
            }
        })

    } catch (error) {
        console.error('Failed to create project:', error)
        return res.status(500).json({ error: 'Failed to start build' })
    }
})

router.get('/', async (req: Request, res: Response) => {
    const userId = res.locals.authUser.userId

    try {
        const projects = await Project.find({ userId }).sort({ createdAt: -1 })
        return res.json({ projects })
    } catch (error) {
        console.error('Failed to fetch projects:', error)
        return res.status(500).json({ error: 'Failed to fetch projects' })
    }
})

router.get('/:slug', async (req: Request, res: Response) => {
    const { slug } = req.params
    const userId = res.locals.authUser.userId

    try {
        const project = await Project.findOne({ slug, userId })
        if (!project) {
            return res.status(404).json({ error: 'Project not found' })
        }
        return res.json({ project })
    } catch (error) {
        console.error('Failed to fetch project:', error)
        return res.status(500).json({ error: 'Failed to fetch project' })
    }
})

router.get('/:slug/deployments', async (req: Request, res: Response) => {
    const { slug } = req.params
    const userId = res.locals.authUser.userId

    try {
        const project = await Project.findOne({ slug, userId })
        if (!project) {
            return res.status(404).json({ error: 'Project not found' })
        }

        const deployments = await Deployment.find({ projectId: project._id }).sort({ createdAt: -1 })
        return res.json({ deployments })
    } catch (error) {
        console.error('Failed to fetch deployments:', error)
        return res.status(500).json({ error: 'Failed to fetch deployments' })
    }
})

router.get('/:slug/deployments/:deploymentId/logs', async (req: Request, res: Response) => {
    const { slug, deploymentId } = req.params
    const userId = res.locals.authUser.userId

    try {
        const project = await Project.findOne({ slug, userId })
        if (!project) {
            return res.status(404).json({ error: 'Project not found' })
        }

        const deployment = await Deployment.findOne({ _id: deploymentId, projectId: project._id })
        if (!deployment) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME as string,
            Key: `__logs/${project.slug}/${deploymentId}/build.log`
        })

        const s3Response = await s3Client.send(command)
        const logContent = await s3Response.Body?.transformToString() || ''
        
        return res.json({ logs: logContent })
    } catch (error: any) {
        if (error.name === 'NoSuchKey') {
            return res.json({ logs: 'No logs found for this deployment.' })
        }
        console.error('Failed to fetch logs from S3:', error)
        return res.status(500).json({ error: 'Failed to fetch logs' })
    }
})

export default router
