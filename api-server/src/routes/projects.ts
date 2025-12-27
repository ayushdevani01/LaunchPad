import { Router, Request, Response } from 'express'
import { generateSlug } from 'random-word-slugs'
import { JobsClient } from '@google-cloud/run'
import { Project } from '../models/Project'
import { authMiddleware } from '../middleware/auth'

const router = Router()
const jobsClient = new JobsClient()

router.use(authMiddleware)

router.post('/', async (req: Request, res: Response) => {
    const { gitURL, project_name, sourceDir } = req.body
    const userId = res.locals.authUser.userId

    if (!gitURL) {
        return res.status(400).json({ error: 'gitURL is required' })
    }

    //GitHub URL only
    const githubRegex = /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i
    if (!githubRegex.test(gitURL)) {
        return res.status(400).json({ error: 'Only GitHub repository URLs are supported' })
    }

    // strip leading/trailing slashes
    const normalizedSourceDir = sourceDir?.trim().replace(/^\/+|\/+$/g, '') || ''

    const projectSlug = project_name?.trim() || generateSlug()

    try {
        const existing = await Project.findOne({ slug: projectSlug })

        if (existing) {
            return res.status(400).json({ error: 'Project name already taken' })
        }
        const project = await Project.create({
            slug: projectSlug,
            gitUrl: gitURL,
            sourceDir: normalizedSourceDir || undefined,
            userId: userId
        })

        const jobPath = process.env.CLOUD_RUN_JOB_PATH as string

        const [execution] = await jobsClient.runJob({
            name: jobPath,
            overrides: {
                containerOverrides: [
                    {
                        env: [
                            { name: 'GIT_REPOSITORY__URL', value: gitURL },
                            { name: 'CLIENT_PROJECT_ID', value: projectSlug },
                            { name: 'REDIS_URL', value: process.env.REDIS_URL },
                            { name: 'SOURCE_DIR', value: normalizedSourceDir }
                        ]
                    }
                ]
            }
        })

        console.log(`Build started for project: ${projectSlug}`)
        console.log(`Execution name: ${execution.name}`)

        return res.json({
            data: {
                projectSlug,
                url: `https://${projectSlug}.launch-pad.dev`,
                executionName: execution.name,
                project
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

export default router
