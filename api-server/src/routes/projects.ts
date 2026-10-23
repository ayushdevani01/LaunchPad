import { Router, Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { Project } from '../models/Project'
import { User } from '../models/User'
import { Deployment } from '../models/Deployment'
import { authMiddleware } from '../middleware/auth'
import axios from 'axios'
import { enqueueDeployment } from '../lib/build-queue'
import { appConfigured, repositoryAccess, repositoryFromURL, userRepositories, githubGet, pages, GitHubAccessError } from '../lib/github-app'
import { publishResult } from '../lib/deployment-result'
import mongoose from 'mongoose'
import { githubSource, githubContentsUrl, GitHubSourceError } from '../lib/github-source'

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
        ...(token ? { Authorization: `token ${token}` } : {}),
        'User-Agent': 'LaunchPad-App',
        Accept: 'application/vnd.github.v3+json'
    }

    const getFileContent = async (filePath: string): Promise<string> => {
        const url = githubContentsUrl(owner, repo, filePath)
        const { data } = await axios.get(url, { headers, params: { ref: branch }, timeout: 15000 })
        
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
                    notes: 'One native Lambda Web Function serves pages, API routes, actions and images. Immutable assets are served from S3 on the same project URL.'
                }
            }
        }

        // Node HTTP servers take precedence over a frontend build tool in a
        // full-stack project. Users can select an optional SPA output folder.
        const serverFramework = [['express', 'Express'], ['fastify', 'Fastify'], ['hono', 'Hono'], ['koa', 'Koa'], ['@nestjs/core', 'NestJS']].find(([name]) => deps[name])
        const startCommand = /^node\s+/.test(pkg.scripts?.['start:prod'] || '') ? pkg.scripts['start:prod'] : pkg.scripts?.start
        if (serverFramework || /^node\s+/.test(startCommand || '')) {
            return {
                framework: serverFramework?.[1] || 'Node.js HTTP Server', supported: 'YES',
                installCommand: 'npm install', buildCommand: pkg.scripts?.build ? 'npm run build' : '',
                startCommand: startCommand || (pkg.main ? `node ${pkg.main}` : ''), outputDir: '',
                notes: 'Runs on native Lambda Web Functions with Node.js 24 and ARM64. Use a production start command such as node dist/server.js. Leave output empty for a backend, or set a static SPA folder and use /api for server routes.'
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
            notes: 'Choose a static output folder or the Node.js Web Function target with a production Node start command.'
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
                    notes: 'No package.json or index.html found. Select a folder containing a Node.js app or static website.'
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
    return res.status(410).json({ error: 'Use the signed GitHub App webhook at /webhooks/github.' })
})

// =========================================================================
// AUTHENTICATED USER ROUTES
// =========================================================================
router.use(authMiddleware)

router.get('/github/repos', async (req: Request, res: Response) => {
    const userId = res.locals.authUser.userId
    try {
        const user = await User.findById(userId)
        if (!appConfigured()) return res.status(503).json({ error: 'The LaunchPad GitHub App setup is incomplete. Repository access is unavailable until it is configured.' })
        if (user?.githubTokenKind !== 'app') return res.json({ repos: [], connectionRequired: true, signInRequired: true })
        const data = await userRepositories(user)
        const repos = data.map((repo: any) => ({
            name: repo.name,
            fullName: repo.full_name,
            gitUrl: repo.clone_url,
            private: repo.private,
            defaultBranch: repo.default_branch
        }))

        return res.json({ repos, connectionRequired: repos.length === 0 })
    } catch (err: any) {
        return res.status(err.status || 502).json({ error: err.message || 'Could not load connected repositories' })
    }
})

router.get('/github/branches', async (req: Request, res: Response) => {
    const userId = res.locals.authUser.userId
    try {
        const { owner, repo } = githubSource(req.query)
        const { token } = await repositoryAccess(await User.findById(userId), owner, repo)
        const data = await pages(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`, token)
        const branches = data.map((b: any) => b.name)
        return res.json({ branches })
    } catch (err: any) {
        return res.status(err instanceof GitHubSourceError ? 400 : err.status || 502).json({ error: err.message || 'Could not load branches' })
    }
})

// Lists the folders directly below a path so the dashboard can offer a folder
// picker instead of asking people to type a monorepo path from memory.
router.get('/github/tree', async (req: Request, res: Response) => {
    const userId = res.locals.authUser.userId

    try {
        const { owner, repo, branch, path } = githubSource(req.query)
        const { token: githubToken } = await repositoryAccess(await User.findById(userId), owner, repo)

        const { data } = await axios.get(
            githubContentsUrl(owner, repo, path),
            {
                params: { ref: branch },
                timeout: 15000,
                headers: {
                    ...(githubToken ? { Authorization: `token ${githubToken}` } : {}),
                    'User-Agent': 'LaunchPad-App',
                    Accept: 'application/vnd.github.v3+json'
                }
            }
        )

        if (!Array.isArray(data)) {
            return res.status(400).json({ error: 'Choose a folder, not a file.' })
        }

        const directories = data
            .filter(entry => entry?.type === 'dir' && typeof entry.name === 'string' && typeof entry.path === 'string')
            .map(entry => ({ name: entry.name, path: entry.path }))
            .sort((a, b) => a.name.localeCompare(b.name))

        return res.json({
            path,
            directories,
            hasPackageJson: data.some(entry => entry?.type === 'file' && entry.name === 'package.json'),
            // GitHub's Contents API caps each directory at 1,000 entries.
            truncated: data.length >= 1000
        })
    } catch (err: any) {
        if (err instanceof GitHubSourceError) return res.status(400).json({ error: err.message })
        if (err instanceof GitHubAccessError) return res.status(err.status).json({ error: err.message })
        const status = err.response?.status
        console.error('Failed to list repository folders:', status || err.code || 'unknown')
        if (status === 404 || status === 409) {
            return res.status(404).json({ error: 'That branch or folder could not be found.' })
        }
        if (status === 403 || status === 429) {
            return res.status(status).json({ error: 'GitHub denied access or its request limit was reached. Check repository access and try again.' })
        }
        return res.status(500).json({ error: 'Failed to list repository folders' })
    }
})

router.get('/github/detect', async (req: Request, res: Response) => {
    const userId = res.locals.authUser.userId

    try {
        const { owner, repo, path, branch } = githubSource(req.query)
        const access = await repositoryAccess(await User.findById(userId), owner, repo)

        const result = await detectFramework(
            owner,
            repo,
            path,
            branch,
            access.token
        )

        return res.json({ detection: { ...result, autoDeployAvailable: !!access.installationId } })
    } catch (err: any) {
        if (err instanceof GitHubSourceError) return res.status(400).json({ error: err.message })
        if (err instanceof GitHubAccessError) return res.status(err.status).json({ error: err.message })
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
    try {
        const { gitURL, project_name, buildCommand, startCommand, installCommand, outputDir, envVars } = req.body
        const source = repositoryFromURL(gitURL)
        const { path: sourceDir, branch } = githubSource({ ...source, path: req.body.sourceDir || '', branch: req.body.branch || 'main' })
        const projectSlug = typeof project_name === 'string' ? project_name.trim() : generateSlug()
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectSlug)) return res.status(400).json({ error: 'Invalid project name' })
        const deploymentTarget = req.body.deploymentTarget || 'auto'
        if (!['auto', 'static', 'nextjs-web', 'nodejs-web'].includes(deploymentTarget)) return res.status(400).json({ error: 'Invalid deployment target' })
        const watchPaths = req.body.watchPaths || []
        if (!Array.isArray(watchPaths) || watchPaths.length > 50) return res.status(400).json({ error: 'Use at most 50 additional watch paths' })
        for (const path of watchPaths) githubSource({ ...source, path })
        if (await Project.exists({ slug: projectSlug })) return res.status(409).json({ error: 'Project name already taken' })
        const userId = res.locals.authUser.userId
        const access = await repositoryAccess(await User.findById(userId), source.owner, source.repo)
        const head = await githubGet(`/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(branch)}`, access.token)
        const project = await Project.create({ slug: projectSlug, gitUrl: access.repo.clone_url, sourceDir, userId, branch,
            githubRepositoryId: access.repo.id, githubInstallationId: access.installationId,
            buildCommand: typeof buildCommand === 'string' ? buildCommand.trim() : undefined,
            startCommand: typeof startCommand === 'string' ? startCommand.trim() : undefined,
            installCommand: typeof installCommand === 'string' ? installCommand.trim() : undefined,
            outputDir: typeof outputDir === 'string' ? outputDir.trim() : undefined,
            envVars, deploymentTarget, watchPaths, autoDeploy: !!access.installationId && req.body.autoDeploy !== false })
        const deployment = await enqueueDeployment(project, head.sha)
        return res.status(202).json({ data: { projectSlug, url: `https://${projectSlug}.${process.env.BASE_DOMAIN || 'launch-pad.dev'}`, project, deployment } })
    } catch (err: any) {
        return res.status(err instanceof GitHubSourceError ? 400 : err.status || 500).json({ error: err.status || err instanceof GitHubSourceError ? err.message : 'Could not queue deployment' })
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
        const user = await User.findById(userId).select('githubTokenKind')
        return res.json({ project: { ...project.toObject(), githubSignInRequired: user?.githubTokenKind !== 'app' } })
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

router.patch('/:slug/automation', async (req: Request, res: Response) => {
    try {
        const project = await Project.findOne({ slug: req.params.slug, userId: res.locals.authUser.userId })
        if (!project) return res.sendStatus(404)
        if (typeof req.body.autoDeploy !== 'boolean') return res.status(400).json({ error: 'autoDeploy must be a boolean' })
        if (req.body.autoDeploy && !project.githubInstallationId) return res.status(409).json({ error: 'Connect this repository before enabling automatic deployments.' })
        project.autoDeploy = req.body.autoDeploy
        await project.save()
        return res.json({ autoDeploy: project.autoDeploy })
    } catch { return res.status(500).json({ error: 'Could not update automatic deployments' }) }
})

router.post('/:slug/redeploy', async (req: Request, res: Response) => {
    const { slug } = req.params
    const userId = res.locals.authUser.userId

    try {
        const project = await Project.findOne({ slug, userId })
        if (!project) {
            return res.status(404).json({ error: 'Project not found' })
        }

        const source = repositoryFromURL(project.gitUrl)
        const access = await repositoryAccess(await User.findById(userId), source.owner, source.repo)
        if (project.githubRepositoryId && project.githubRepositoryId !== access.repo.id) {
            return res.status(403).json({ error: 'Connect this project repository to the LaunchPad GitHub App first.' })
        }
        project.githubRepositoryId = access.repo.id
        project.githubInstallationId = access.installationId
        project.gitUrl = access.repo.clone_url
        if (!access.installationId) project.autoDeploy = false
        await project.save()
        const head = await githubGet(`/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(project.branch || 'main')}`, access.token)
        const deployment = await enqueueDeployment(project, head.sha)
        return res.status(202).json({ success: true, deployment })
    } catch (err: any) {
        return res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not queue redeployment' })
    }
})

export default router
