import { Router, Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { Project } from '../models/Project'
import { User } from '../models/User'
import { Deployment } from '../models/Deployment'
import { authMiddleware } from '../middleware/auth'
import axios from 'axios'
import { triggerBuildTask } from '../lib/build-task'
import { githubAccessToken } from '../lib/github-token'
import { publishResult } from '../lib/deployment-result'
import mongoose from 'mongoose'

const router = Router()

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
        console.warn(`[AWS_ENDPOINT] Ignoring invalid AWS_ENDPOINT URL: "${trimmed}"`)
        return undefined
    }
}

const awsEndpoint = getAwsEndpoint()

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    endpoint: awsEndpoint,
    forcePathStyle: awsEndpoint ? true : undefined,
    ...(awsEndpoint ? { credentials: { accessKeyId: 'mock', secretAccessKey: 'mock' } } : {})
})

// Framework Auto-Detector Helper
async function detectFramework(owner: string, repo: string, pathStr: string, branch: string, token: string) {
    const headers = {
        Authorization: `token ${token}`,
        'User-Agent': 'LaunchPad-App',
        Accept: 'application/vnd.github.v3+json'
    }

    const getFileContent = async (filePath: string): Promise<string> => {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`
        const { data } = await axios.get(url, { headers })
        
        if (data.encoding === 'base64' && data.content) {
            return Buffer.from(data.content, 'base64').toString('utf8')
        }
        
        if (typeof data === 'string') return data
        throw new Error('Unexpected response format from GitHub API')
    }

    const basePath = pathStr ? `${pathStr}/` : ''

    try {
        const packageJsonStr = await getFileContent(`${basePath}package.json`)
        let pkg: any
        try {
            pkg = JSON.parse(packageJsonStr)
        } catch {
            throw new Error('Failed to parse package.json')
        }

        const deps = { ...pkg.dependencies, ...pkg.devDependencies }

        // 1. Next.js
        if (deps['next']) {
            const configNames = ['next.config.js', 'next.config.mjs', 'next.config.ts']
            let hasStaticExport = false
            for (const name of configNames) {
                try {
                    const configContent = await getFileContent(`${basePath}${name}`)
                    if (configContent.includes("output: 'export'") || configContent.includes('output: "export"')) {
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
                    framework: 'Next.js',
                    supported: 'YES',
                    installCommand: 'npm install',
                    buildCommand: 'npm run build',
                    outputDir: '',
                    notes: 'Server rendering and API routes deploy to AWS Lambda. Static assets are served from S3.'
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

        // 8. React (plain, without build tool)
        if (deps['react']) {
            return {
                framework: 'React (Custom Setup)',
                supported: 'PARTIAL',
                installCommand: 'npm install',
                buildCommand: 'npm run build',
                outputDir: 'dist',
                notes: 'React project detected with a custom build setup. Ensure it outputs static HTML/JS/CSS assets and set the correct output directory.'
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
        // package.json not found — check for static HTML fallback
        const isNotFound = err.response?.status === 404 || err.message?.includes('Failed to parse')
        if (isNotFound) {
            try {
                await getFileContent(`${basePath}index.html`)
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
// Callback notification: private S3 result is verified before status is changed.
// =========================================================================
router.post('/:slug/deployments/:deploymentId/status', async (req: Request, res: Response) => {
    const { slug, deploymentId } = req.params
    if (typeof deploymentId !== 'string' || !mongoose.isValidObjectId(deploymentId)) return res.status(400).json({ error: 'Invalid deployment' })
    try {
        const project = await Project.findOne({ slug })
        if (!project) return res.status(404).json({ error: 'Project not found' })
        const deployment = await Deployment.findOne({ _id: deploymentId, projectId: project._id })
        if (!deployment) return res.status(404).json({ error: 'Deployment not found' })
        const result = await publishResult(s3Client, project, deployment)
        return res.json({ success: true, status: result.status })
    } catch {
        return res.status(409).json({ error: 'Verified deployment result is not available yet' })
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
        const projects = await Project.find({
            $or: [
                { gitUrl: gitUrl },
                { gitUrl: `${gitUrl}.git` },
                { gitUrl: gitUrl.replace(/\.git$/, '') }
            ],
            branch: branchName
        })
        if (projects.length === 0) {
            console.log(`[WEBHOOK] No projects found matching gitUrl: ${gitUrl}, branch: ${branchName}`)
            return res.status(200).json({ message: 'No matching projects found' })
        }

        for (const project of projects) {
            console.log(`[WEBHOOK] Triggering automated deployment for project: ${project.slug}`)

            // Get the user's github token to clone private repos if necessary
            const user = await User.findById(project.userId)
            const githubToken = await githubAccessToken(user)

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
        const githubToken = await githubAccessToken(user)
        if (!githubToken) {
            return res.status(400).json({ error: 'GitHub account not linked. Please login via GitHub.' })
        }

        const { data } = await axios.get('https://api.github.com/user/repos?per_page=100&sort=updated', {
            headers: {
                Authorization: `token ${githubToken}`,
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
        const githubToken = await githubAccessToken(user)
        if (!githubToken) {
            return res.status(400).json({ error: 'GitHub account not linked.' })
        }

        const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches`, {
            headers: {
                Authorization: `token ${githubToken}`,
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
        const githubToken = await githubAccessToken(user)
        if (!githubToken) {
            return res.status(400).json({ error: 'GitHub account not linked.' })
        }

        const result = await detectFramework(
            owner as string,
            repo as string,
            path as string,
            branch as string,
            githubToken
        )

        return res.json({ detection: result })
    } catch (err: any) {
        console.error('Failed to detect framework:', err.response?.data || err.message)
        return res.status(500).json({ error: 'Failed to analyze repository contents' })
    }
})

router.get('/check-name', async (req: Request, res: Response) => {
    const { name } = req.query
    if (!name) {
        return res.status(400).json({ error: 'name query parameter is required' })
    }

    const slug = (name as string).trim().toLowerCase()
    
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    if (!slugRegex.test(slug)) {
        return res.status(400).json({ error: 'Invalid project name format' })
    }

    try {
        const existing = await Project.findOne({ slug })
        if (existing) {
            return res.json({ available: false })
        }
        return res.json({ available: true })
    } catch (error) {
        console.error('Failed to check project name:', error)
        return res.status(500).json({ error: 'Internal server error' })
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
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectSlug)) return res.status(400).json({ error: 'Invalid project name' })
    const deploymentTarget = req.body.deploymentTarget || 'auto'
    if (!['auto', 'static', 'nextjs-lambda'].includes(deploymentTarget)) return res.status(400).json({ error: 'Invalid deployment target' })

    try {
        const existing = await Project.findOne({ slug: projectSlug })
        if (existing) {
            return res.status(400).json({ error: 'Project name already taken' })
        }

        const user = await User.findById(userId)
        const githubToken = await githubAccessToken(user)

        const project = await Project.create({
            slug: projectSlug,
            gitUrl: gitURL,
            sourceDir: normalizedSourceDir || undefined,
            userId: userId,
            buildCommand: buildCommand?.trim() || undefined,
            installCommand: installCommand?.trim() || undefined,
            outputDir: outputDir?.trim() || undefined,
            branch: branch?.trim() || 'main',
            envVars,
            deploymentTarget
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
            return res.json({ logs: 'No logs found for this deployment.', pending: true })
        }
        console.error('Failed to fetch logs from S3:', error)
        return res.status(500).json({ error: 'Failed to fetch logs' })
    }
})

router.post('/:slug/redeploy', async (req: Request, res: Response) => {
    const { slug } = req.params
    const userId = res.locals.authUser.userId

    try {
        const project = await Project.findOne({ slug, userId })
        if (!project) {
            return res.status(404).json({ error: 'Project not found' })
        }

        const user = await User.findById(userId)
        const githubToken = await githubAccessToken(user)

        const deployment = await Deployment.create({
            projectId: project._id,
            status: 'BUILDING'
        })

        const executionName = await triggerBuildTask(project, deployment, githubToken)

        console.log(`[MANUAL REDEPLOY] Project ${slug} manual redeployment started. ID: ${deployment._id}`)

        return res.json({
            success: true,
            deployment,
            executionName
        })
    } catch (error) {
        console.error('[MANUAL REDEPLOY] Failed to trigger manual redeployment:', error)
        return res.status(500).json({ error: 'Failed to start redeployment' })
    }
})

export default router
