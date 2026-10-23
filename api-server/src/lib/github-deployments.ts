import axios from 'axios'
import { randomUUID } from 'crypto'
import { Deployment, IGitHubReport } from '../models/Deployment'
import { Project } from '../models/Project'
import { appConfigured, deploymentReportingToken, githubHeaders, repositoryFromURL } from './github-app'

type ReportState = 'queued' | 'in_progress' | 'success' | 'failure' | 'inactive'
const descriptions: Record<ReportState, string> = {
    queued: 'LaunchPad: queued for a build',
    in_progress: 'LaunchPad: build in progress',
    success: 'LaunchPad: deployment is live',
    failure: 'LaunchPad: build failed; the previous live site is unchanged',
    inactive: 'LaunchPad: superseded by another deployment',
}

// Saved with the build's outbox record, without making any GitHub requests.
// Existing historical jobs are deliberately not backfilled on server startup.
export function githubReportFor(project: any, deploymentId: string): IGitHubReport | undefined {
    if (process.env.GITHUB_DEPLOYMENTS_ENABLED === 'false' || !project.githubInstallationId || !project.githubRepositoryId) return
    try {
        const source = repositoryFromURL(project.gitUrl)
        const frontend = new URL(process.env.FRONTEND_URL || 'https://launch-pad.dev')
        if (!['http:', 'https:'].includes(frontend.protocol)) throw new Error('Invalid frontend URL')
        const log = new URL(`/project/${encodeURIComponent(project.slug)}`, frontend)
        log.searchParams.set('deployment', deploymentId)
        return { installationId: project.githubInstallationId, repositoryId: project.githubRepositoryId,
            ...source, environment: `LaunchPad / ${project.slug}`, logUrl: log.href,
            siteUrl: new URL(`https://${project.slug}.${process.env.BASE_DOMAIN || 'launch-pad.dev'}`).href,
            sentStates: [], attempts: 0, done: false, nextAttemptAt: new Date() }
    } catch { console.error('GitHub deployment reporting configuration is invalid; the build can still proceed') }
}

export function reportStates(deployment: any, project: any): ReportState[] {
    const states: ReportState[] = ['queued']
    if (deployment.taskArn) states.push('in_progress')
    if (deployment.status === 'FAILED') states.push('failure')
    if (deployment.status === 'SUCCESS') {
        if (String(project?.currentDeployment) === String(deployment._id)) states.push('success')
        // Status and promotion are separate writes. Wait for promotion when this
        // is still the latest request rather than reporting an early inactive.
        else if (String(project?.latestDeployment) !== String(deployment._id)) states.push('inactive')
    }
    return states
}

function remotePayload(value: unknown): any {
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) } catch { return null }
}

export async function syncGitHubReport(deployment: any) {
    const report = deployment.githubReport as IGitHubReport
    if (!report?.leaseToken) throw new Error('A reporting lease is required')
    const owned = { _id: deployment._id, 'githubReport.leaseToken': report.leaseToken }
    const save = async (fields: Partial<IGitHubReport>, unset: string[] = []) => {
        const update = await Deployment.updateOne({ ...owned, 'githubReport.leaseUntil': { $gt: new Date() } }, {
            $set: { ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [`githubReport.${key}`, value])),
                'githubReport.leaseUntil': new Date(Date.now() + 120000) },
            ...(unset.length ? { $unset: Object.fromEntries(unset.map(key => [`githubReport.${key}`, 1])) } : {}),
        })
        if (update.matchedCount !== 1) throw new Error('GitHub reporting lease expired')
        Object.assign(report, fields)
        for (const key of unset) (report as any)[key] = undefined
    }
    const project = await Project.findById(deployment.projectId)
    if (!project || project.githubInstallationId !== report.installationId || project.githubRepositoryId !== report.repositoryId) {
        await save({ done: true, lastError: 'Repository connection was removed or changed' })
        return
    }
    const wanted = reportStates(deployment, project)
    const pending = wanted.filter(state => !report.sentStates.includes(state))
    if (pending.length) {
        const token = await deploymentReportingToken(report.installationId, report.repositoryId)
        const prefix = `https://api.github.com/repos/${encodeURIComponent(report.owner)}/${encodeURIComponent(report.repo)}/deployments`
        const config = { headers: githubHeaders(token), timeout: 15000 }
        if (!report.remoteId) {
            if (report.createAttempted) {
                // Recover a successful POST whose response or Mongo write was
                // lost. GitHub has no deployment-creation idempotency key.
                for (let page = 1; page <= 10; page++) {
                    await save({})
                    const { data } = await axios.get(prefix, { ...config, params: { sha: deployment.commitHash,
                        environment: report.environment, task: 'deploy', per_page: 100, page } })
                    if (!Array.isArray(data)) throw new Error('Invalid GitHub deployment listing')
                    const match = data.find(item => item.sha === deployment.commitHash &&
                        remotePayload(item.payload)?.launchpadDeploymentId === String(deployment._id))
                    if (match) {
                        if (!Number.isSafeInteger(match.id) || match.id <= 0) throw new Error('Invalid GitHub deployment ID')
                        await save({ remoteId: match.id }); break
                    }
                    if (data.length < 100) break
                    if (page === 10) throw new Error('GitHub deployment recovery listing is incomplete')
                }
            }
            if (!report.remoteId) {
                await save({ createAttempted: true })
                const { data } = await axios.post(prefix, { ref: deployment.commitHash, environment: report.environment,
                    auto_merge: false, required_contexts: [], production_environment: true, transient_environment: false,
                    description: `LaunchPad deployment for ${project.slug}`,
                    payload: { launchpadDeploymentId: String(deployment._id), projectSlug: project.slug } }, config)
                if (!Number.isSafeInteger(data.id) || data.id <= 0) throw new Error('Invalid GitHub deployment ID')
                await save({ remoteId: data.id })
            }
        }
        for (const state of pending) {
            let delivered = false
            if (report.pendingState) {
                await save({})
                const { data } = await axios.get(`${prefix}/${report.remoteId}/statuses`, { ...config, params: { per_page: 100 } })
                if (!Array.isArray(data)) throw new Error('Invalid GitHub deployment statuses')
                delivered = data[0]?.state === state && data[0]?.log_url === report.logUrl
            }
            if (!delivered) {
                await save({ pendingState: state })
                await axios.post(`${prefix}/${report.remoteId}/statuses`, { state, environment: report.environment,
                    environment_url: report.siteUrl, log_url: report.logUrl,
                    description: descriptions[state], auto_inactive: false }, config)
            }
            await save({ sentStates: [...report.sentStates, state] }, ['pendingState'])
        }
    }
    const last = wanted[wanted.length - 1]
    const done = last === 'failure' || last === 'inactive'
    // Successful live deployments stay eligible for a cheap Mongo check. Once
    // a newer deployment is actually live, mark the old GitHub record inactive.
    await save({ done, attempts: 0, nextAttemptAt: new Date(Date.now() + (last === 'success' ? 30000 : 3000)) }, ['lastError'])
}

export async function syncPendingGitHubReports(limit = 25) {
    if (!appConfigured() || process.env.GITHUB_DEPLOYMENTS_ENABLED === 'false') return
    for (let index = 0; index < limit; index++) {
        const leaseToken = randomUUID()
        const deployment = await Deployment.findOneAndUpdate({ 'githubReport.done': false,
            'githubReport.nextAttemptAt': { $lte: new Date() },
            $or: [{ 'githubReport.leaseUntil': { $exists: false } }, { 'githubReport.leaseUntil': { $lt: new Date() } }] },
            { $set: { 'githubReport.leaseToken': leaseToken, 'githubReport.leaseUntil': new Date(Date.now() + 120000) },
                $inc: { 'githubReport.attempts': 1 } },
            { sort: { 'githubReport.nextAttemptAt': 1 }, returnDocument: 'after' }).select('+githubReport')
        if (!deployment) return
        try { await syncGitHubReport(deployment) }
        catch (error: any) {
            const status = error.response?.status
            const seconds = Math.min(900, 5 * 2 ** Math.min(deployment.githubReport?.attempts || 1, 8))
            const retryAfter = Number(error.response?.headers?.['retry-after'])
            const delay = Math.max(seconds * 1000, Number.isFinite(retryAfter) ? Math.min(retryAfter, 3600) * 1000 : 0)
            // Axios errors contain authorization headers; never log/store them.
            await Deployment.updateOne({ _id: deployment._id, 'githubReport.leaseToken': leaseToken }, {
                $set: { 'githubReport.nextAttemptAt': new Date(Date.now() + delay),
                    'githubReport.lastError': `GitHub deployment reporting unavailable${Number.isInteger(status) ? ` (HTTP ${status})` : ''}` },
            })
        } finally {
            await Deployment.updateOne({ _id: deployment._id, 'githubReport.leaseToken': leaseToken }, {
                $unset: { 'githubReport.leaseUntil': 1, 'githubReport.leaseToken': 1 },
            })
        }
    }
}

export function startGitHubDeploymentReporter() {
    let stopped = false
    let timer: NodeJS.Timeout | undefined
    let running: Promise<void> | undefined
    const run = () => {
        running = syncPendingGitHubReports().catch(() => console.error('GitHub deployment reports will be retried')).finally(() => {
            if (!stopped) { timer = setTimeout(run, 3000); timer.unref() }
        })
    }
    run()
    return async () => { stopped = true; if (timer) clearTimeout(timer); await running }
}
