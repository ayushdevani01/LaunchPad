import { Router } from 'express'
import { randomBytes, createHash } from 'crypto'
import { authMiddleware } from '../middleware/auth'
import { GitHubConnection, GitHubInstallation } from '../models/GitHubConnection'
import { User } from '../models/User'
import { Project } from '../models/Project'
import { appConfigured, appJWT, appUserToken, githubGet, pages, repositoryFromURL, GitHubAccessError } from '../lib/github-app'

const router = Router()
router.get('/install/callback', async (req, res) => {
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000'
    let returnPath = '/launch'
    try {
        if (typeof req.query.state !== 'string' || !/^[a-f0-9]{64}$/.test(req.query.state)) throw new Error('Invalid connection state')
        const connection = await GitHubConnection.findOneAndDelete({ stateHash: createHash('sha256').update(req.query.state).digest('hex'), expiresAt: { $gt: new Date() } })
        if (!connection) throw new Error('Connection expired. Start again from LaunchPad.')
        if (connection.projectSlug) returnPath = `/project/${encodeURIComponent(connection.projectSlug)}`
        if (req.query.setup_action === 'request') throw new Error('Organization approval is pending. Connect again after an administrator approves the installation.')
        const id = Number(req.query.installation_id)
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid installation')
        const installation = await githubGet(`/app/installations/${id}`, appJWT())
        if (installation.repository_selection !== 'selected' || installation.suspended_at) throw new Error('Choose Only select repositories in the GitHub App installation, then reconnect.')
        const token = await appUserToken(await User.findById(connection.userId))
        const repos = await pages(`/user/installations/${id}/repositories`, token, 'repositories')
        if (!repos.length) throw new Error('No selected repositories are accessible to your GitHub account.')
        await GitHubInstallation.updateOne({ installationId: id }, { $set: { deleted: false, suspended: false } }, { upsert: true })
        if (connection.projectSlug) {
            const project = await Project.findOne({ slug: connection.projectSlug, userId: connection.userId })
            if (!project) throw new Error('Project not found')
            const source = repositoryFromURL(project.gitUrl)
            const repo = repos.find(item => project.githubRepositoryId
                ? item.id === project.githubRepositoryId
                : item.full_name.toLowerCase() === `${source.owner}/${source.repo}`.toLowerCase())
            if (!repo) throw new Error('Select this project repository in the installation before reconnecting.')
            project.githubRepositoryId = repo.id
            project.githubInstallationId = id
            project.gitUrl = repo.clone_url
            await project.save()
        }
        res.redirect(`${frontend}${returnPath}?github=connected`)
    } catch (err: any) {
        const message = err instanceof GitHubAccessError ? err.message : (err.message || 'Could not connect GitHub repositories')
        res.redirect(`${frontend}${returnPath}?githubError=${encodeURIComponent(message)}`)
    }
})

router.use(authMiddleware)
router.post('/install/start', async (req, res) => {
    try {
        if (!appConfigured()) return res.status(503).json({ error: 'The LaunchPad GitHub App has not been configured yet.' })
        await appUserToken(await User.findById(res.locals.authUser.userId))
        let projectSlug: string | undefined
        if (req.body.projectSlug) {
            const project = await Project.findOne({ slug: req.body.projectSlug, userId: res.locals.authUser.userId })
            if (!project) return res.sendStatus(404)
            projectSlug = project.slug
        }
        const state = randomBytes(32).toString('hex')
        await GitHubConnection.create({ stateHash: createHash('sha256').update(state).digest('hex'),
            userId: res.locals.authUser.userId, projectSlug, expiresAt: new Date(Date.now() + 600000) })
        res.json({ url: `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG!)}/installations/new?state=${state}` })
    } catch (err: any) { res.status(err.status || 503).json({ error: err.message || 'Could not start GitHub connection' }) }
})
export default router
