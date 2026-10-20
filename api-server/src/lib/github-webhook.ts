import { createHmac, timingSafeEqual } from 'crypto'

export function validWebhookSignature(body: Buffer, signature: string, secret: string) {
    if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false
    const digest = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}

const sharedInputs = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
    'bun.lock', 'bun.lockb', 'pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json']
export function watchedChange(paths: string[], sourceDir: string, extra: string[] = []) {
    if (!sourceDir) return true
    const directories = [sourceDir, 'packages', ...extra].map(path => path.replace(/\/$/, ''))
    return paths.some(path => sharedInputs.includes(path) || directories.some(dir => path === dir || path.startsWith(`${dir}/`)))
}

export function normalizeWebhook(event: string, payload: any) {
    const installationId = payload.installation?.id
    if (!Number.isSafeInteger(installationId) || installationId < 1) throw new Error('Installation ID is required')
    if (event === 'push') {
        if (!Number.isSafeInteger(payload.repository?.id) || typeof payload.ref !== 'string' ||
            !/^[a-f0-9]{40}$/.test(payload.after || '')) throw new Error('Invalid push payload')
        return { installationId, repositoryId: payload.repository.id, ref: payload.ref,
            after: payload.after, before: payload.before, deleted: payload.deleted === true }
    }
    return { installationId, action: payload.action, suspended: !!payload.installation.suspended_at,
        removedRepositoryIds: event === 'installation_repositories' && Array.isArray(payload.repositories_removed)
            ? payload.repositories_removed.map((repo: any) => repo.id).filter((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0)
            : [] }
}
