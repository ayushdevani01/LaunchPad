import { Router } from 'express'
import { createHash } from 'crypto'
import mongoose from 'mongoose'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'
import { installationToken, githubGet, repositoryFromURL } from '../lib/github-app'

const router = Router()
router.post('/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const authorization = req.get('authorization')?.replace(/^Bearer /, '') || ''
    if (!mongoose.isValidObjectId(req.params.id) || !/^[a-f0-9]{64}$/.test(authorization)) return res.sendStatus(401)
    try {
        // Consume before returning credentials. Customer scripts cannot reuse the
        // initial container environment to retrieve a GitHub token after cloning.
        const deployment = await Deployment.findOneAndUpdate({ _id: req.params.id,
            status: { $in: ['PENDING', 'BUILDING'] }, cloneAuthConsumedAt: { $exists: false },
            cloneAuthExpiresAt: { $gt: new Date() }, cloneAuthHash: createHash('sha256').update(authorization).digest('hex') },
            { $set: { cloneAuthConsumedAt: new Date() } })
        if (!deployment) return res.sendStatus(401)
        const project = await Project.findById(deployment.projectId)
        if (!project?.githubRepositoryId) return res.sendStatus(403)
        if (!project.githubInstallationId) {
            const source = repositoryFromURL(project.gitUrl)
            const repo = await githubGet(`/repos/${source.owner}/${source.repo}`, '')
            if (repo.private !== false || repo.id !== project.githubRepositoryId) return res.sendStatus(403)
            return res.json({ public: true })
        }
        const token = await installationToken(project.githubInstallationId, project.githubRepositoryId)
        return res.json({ token })
    } catch { return res.status(503).json({ error: 'Source authorization is unavailable. Start a new deployment.' }) }
})
export default router
