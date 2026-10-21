import { Router } from 'express'
import mongoose from 'mongoose'
import { workerAuth } from '../lib/worker-auth'
import { randomBytes, createHash } from 'crypto'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'
import { User } from '../models/User'
import { repositoryAccess, repositoryFromURL, githubGet } from '../lib/github-app'

const router = Router()
router.use(workerAuth)
router.post('/:id/source', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(400)
    try {
        const deployment = await Deployment.findById(req.params.id)
        if (!deployment || !['PENDING', 'BUILDING'].includes(deployment.status)) return res.sendStatus(409)
        const project = await Project.findById(deployment.projectId)
        if (!project?.githubRepositoryId) return res.status(403).json({ error: 'Connect this repository to the LaunchPad GitHub App before deploying.' })
        const source = repositoryFromURL(project.gitUrl)
        if (project.githubInstallationId) {
            const access = await repositoryAccess(await User.findById(project.userId), source.owner, source.repo)
            if (access.repo.id !== project.githubRepositoryId || access.installationId !== project.githubInstallationId) return res.sendStatus(403)
        } else {
            const repo = await githubGet(`/repos/${source.owner}/${source.repo}`, '')
            if (repo.private !== false || repo.id !== project.githubRepositoryId) return res.sendStatus(403)
        }
        const authorization = randomBytes(32).toString('hex')
        await Deployment.updateOne({ _id: deployment._id }, { $set: {
            cloneAuthHash: createHash('sha256').update(authorization).digest('hex'),
            cloneAuthExpiresAt: new Date(Date.now() + 20 * 60000)
        }, $unset: { cloneAuthConsumedAt: 1 } })
        res.set('Cache-Control', 'no-store').json({ authorization })
    } catch (err: any) {
        res.status(err.status || 503).json({ error: err.status === 403 ? err.message : 'GitHub source authorization is temporarily unavailable' })
    }
})
export default router
