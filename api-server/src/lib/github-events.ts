import axios from 'axios'
import { GitHubDelivery, GitHubInstallation } from '../models/GitHubConnection'
import { Project } from '../models/Project'
import { Deployment } from '../models/Deployment'
import { installationToken, githubGet, githubHeaders, appConfigured, appJWT, repositoryFromURL } from './github-app'
import { watchedChange } from './github-webhook'
import { enqueueDeployment } from './build-queue'

export async function processDelivery(receipt: any) {
    const event = receipt.payload
    if (receipt.event !== 'push') {
        if (receipt.event === 'installation') await GitHubInstallation.updateOne({ installationId: event.installationId },
            { $set: { deleted: event.action === 'deleted', suspended: event.action === 'suspend' || event.suspended } }, { upsert: true })
        if (receipt.event === 'installation' && (event.action === 'deleted' || event.action === 'suspend' || event.suspended)) {
            await Project.updateMany({ githubInstallationId: event.installationId },
                { $set: { autoDeploy: false }, $unset: { githubInstallationId: 1 } })
        }
        if (receipt.event === 'installation_repositories' && event.removedRepositoryIds?.length) {
            await Project.updateMany({ githubInstallationId: event.installationId, githubRepositoryId: { $in: event.removedRepositoryIds } },
                { $set: { autoDeploy: false }, $unset: { githubInstallationId: 1 } })
        }
        return
    }
    if (!event.ref.startsWith('refs/heads/')) return
    const state = await GitHubInstallation.findOne({ installationId: event.installationId })
    if (state?.deleted || state?.suspended) return
    const projects = await Project.find({ githubRepositoryId: event.repositoryId, githubInstallationId: event.installationId,
        branch: event.ref.slice('refs/heads/'.length), autoDeploy: true })
    for (const project of projects) {
        await GitHubDelivery.updateOne({ _id: receipt._id }, { $set: { leaseUntil: new Date(Date.now() + 300000) } })
        if (event.deleted) { project.autoDeploy = false; await project.save(); continue }
        const token = await installationToken(event.installationId, event.repositoryId)
        const source = repositoryFromURL(project.gitUrl)
        const prefix = `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`
        const head = await githubGet(`${prefix}/commits/${encodeURIComponent(project.branch || 'main')}`, token)
        if (head.sha !== event.after) continue // An older delivery must not roll the project back.
        const current = project.currentDeployment ? await Deployment.findById(project.currentDeployment) : null
        let relevant = true
        if (project.sourceDir && current?.commitHash && current.commitHash !== event.after) {
            try {
                const comparison = await githubGet(`${prefix}/compare/${current.commitHash}...${event.after}`, token, { per_page: 100 })
                const files = comparison.files
                // GitHub caps comparison files at 300. Unknown or incomplete
                // comparisons must build rather than silently skip changes.
                if (Array.isArray(files) && files.length < 300 && comparison.status !== 'diverged') {
                    relevant = watchedChange(files.flatMap((file: any) => [file.filename, file.previous_filename].filter(Boolean)), project.sourceDir, project.watchPaths)
                }
            } catch { relevant = true }
        }
        if (current?.commitHash === event.after) continue
        if (relevant) await enqueueDeployment(project, event.after, 'push')
    }
}

export async function processPendingDeliveries() {
    for (let i = 0; i < 25; i++) {
        const receipt = await GitHubDelivery.findOneAndUpdate({ processedAt: { $exists: false },
            $and: [{ $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] },
                { $or: [{ retryAt: { $exists: false } }, { retryAt: { $lt: new Date() } }] }] },
            { $set: { leaseUntil: new Date(Date.now() + 300000) }, $inc: { attempts: 1 } }, { sort: { _id: 1 }, returnDocument: 'after' })
        if (!receipt) return
        try {
            await processDelivery(receipt)
            await GitHubDelivery.updateOne({ _id: receipt._id }, { $set: { processedAt: new Date() }, $unset: { leaseUntil: 1, lastError: 1 } })
        } catch {
            await GitHubDelivery.updateOne({ _id: receipt._id }, { $set: { retryAt: new Date(Date.now() + Math.min(600000, 5000 * 2 ** Math.min(receipt.attempts || 1, 7))),
                lastError: 'GitHub event processing temporarily unavailable' }, $unset: { leaseUntil: 1 } })
        }
    }
}

// GitHub does not redeliver failed webhooks automatically. Request redelivery
// of recent failed attempts; receipt IDs make repeated deliveries harmless.
export async function recoverFailedDeliveries() {
    const token = appJWT()
    const deliveries = await githubGet('/app/hook/deliveries', token, { per_page: 100 })
    for (const delivery of deliveries) {
        if (delivery.status_code >= 200 && delivery.status_code < 300) continue
        if (!delivery.guid || Date.parse(delivery.delivered_at) < Date.now() - 24 * 3600000) continue
        const received = await GitHubDelivery.exists({ deliveryId: delivery.guid })
        if (!received && !delivery.redelivery) await axios.post(`https://api.github.com/app/hook/deliveries/${delivery.id}/attempts`, {},
            { headers: githubHeaders(token), timeout: 15000 })
    }
}

export function startGitHubEvents() {
    let running = false
    let lastRecovery = Date.now()
    const timer = setInterval(async () => {
        if (running || !appConfigured()) return
        running = true
        try {
            await processPendingDeliveries()
            if (Date.now() - lastRecovery > 10 * 60000) { lastRecovery = Date.now(); await recoverFailedDeliveries() }
        } catch { console.error('GitHub events temporarily unavailable; saved receipts will be retried') }
        finally { running = false }
    }, 2000)
    timer.unref()
    return () => clearInterval(timer)
}
