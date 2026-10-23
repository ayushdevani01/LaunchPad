import axios from 'axios'
import { readFileSync } from 'fs'
import jwt from 'jsonwebtoken'
import { IUser } from '../models/User'
import { githubAccessToken } from './github-token'
import { GitHubInstallation } from '../models/GitHubConnection'

export class GitHubAccessError extends Error {
    constructor(message: string, public status = 403) { super(message) }
}

export function appConfigured() {
    return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_SLUG &&
        process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET && process.env.GITHUB_APP_PRIVATE_KEY_PATH)
}

export function githubHeaders(token: string) {
    return { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/vnd.github+json',
        'User-Agent': 'LaunchPad', 'X-GitHub-Api-Version': '2022-11-28' }
}

export async function githubGet(path: string, token: string, params?: Record<string, unknown>) {
    try {
        return (await axios.get(`https://api.github.com${path}`, { headers: githubHeaders(token), params, timeout: 15000 })).data
    } catch (err: any) {
        const status = err.response?.status
        if (status === 401) throw new GitHubAccessError('Your GitHub session expired. Sign in again.', 403)
        if (status === 403 || status === 429) throw new GitHubAccessError('GitHub denied access or its request limit was reached. Check repository permissions and try again.', status)
        if (status === 404) throw new GitHubAccessError('That repository, branch or folder is unavailable. Check the selected repositories in your GitHub installation.', 404)
        throw new GitHubAccessError('GitHub could not be reached. Try again shortly.', 502)
    }
}

export function appJWT() {
    if (!appConfigured()) throw new GitHubAccessError('GitHub App setup is incomplete.', 503)
    const now = Math.floor(Date.now() / 1000)
    return jwt.sign({ iat: now - 60, exp: now + 540, iss: process.env.GITHUB_APP_ID },
        readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH!, 'utf8'), { algorithm: 'RS256' })
}

export async function appUserToken(user: IUser | null) {
    if (!user || user.githubTokenKind !== 'app' || !user.githubId) {
        throw new GitHubAccessError('Sign in with the LaunchPad GitHub App, then connect the repositories you want to deploy.', 403)
    }
    const token = await githubAccessToken(user)
    if (!token) throw new GitHubAccessError('Please sign in with GitHub again.', 403)
    return token
}

export async function pages(path: string, token: string, field?: string) {
    const result: any[] = []
    for (let page = 1; page <= 100; page++) {
        const data = await githubGet(path, token, { per_page: 100, page })
        const items = field ? data[field] : data
        if (!Array.isArray(items)) throw new GitHubAccessError('GitHub returned an invalid repository listing.', 502)
        result.push(...items)
        if (items.length < 100) return result
    }
    throw new GitHubAccessError('Too many repositories to list at once. Narrow your GitHub App installation.', 400)
}

export async function userRepositories(user: IUser | null) {
    const token = await appUserToken(user)
    const installations = await pages('/user/installations', token, 'installations')
    const repos: any[] = []
    for (const installation of installations) {
        if (installation.suspended_at || installation.repository_selection !== 'selected') continue
        const state = await GitHubInstallation.findOne({ installationId: installation.id })
        if (state?.deleted || state?.suspended) continue
        const selected = await pages(`/user/installations/${installation.id}/repositories`, token, 'repositories')
        repos.push(...selected.map(repo => ({ ...repo, installationId: installation.id })))
    }
    return repos
}

export async function repositoryAccess(user: IUser | null, owner: string, name: string) {
    const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    // Public URL deployments remain available without granting repository
    // access. Never substitute a legacy broad OAuth token for an installation.
    let token = ''
    if (user?.githubTokenKind === 'app') token = await appUserToken(user)
    const repo = await githubGet(prefix, token)
    let installation: any
    try { installation = await githubGet(`${prefix}/installation`, appJWT()) }
    catch (error) {
        if (repo.private === false && (error instanceof GitHubAccessError) && [404, 503].includes(error.status)) {
            const publicRepo = await githubGet(prefix, '')
            if (publicRepo.private === false) return { token: '', repo: publicRepo, installationId: undefined }
        }
        throw error
    }
    if (!token) {
        if (repo.private === false) return { token: '', repo, installationId: undefined }
        throw new GitHubAccessError('Sign in with the LaunchPad GitHub App, then connect this repository.')
    }
    if (installation.repository_selection !== 'selected' || installation.suspended_at) {
        throw new GitHubAccessError('Choose Only select repositories in the LaunchPad GitHub App installation.')
    }
    const state = await GitHubInstallation.findOne({ installationId: installation.id })
    if (state?.deleted || state?.suspended) throw new GitHubAccessError('The GitHub App installation was removed or suspended. Reconnect it.')
    // A successful user-token repository read proves the user/app/installation intersection.
    return { token, repo, installationId: installation.id as number }
}

async function mintInstallationToken(installationId: number, repositoryId: number, permissions: { contents?: 'read'; deployments?: 'write' }) {
    const state = await GitHubInstallation.findOne({ installationId })
    if (state?.deleted || state?.suspended) throw new GitHubAccessError('Repository installation is no longer active.')
    const { data } = await axios.post(`https://api.github.com/app/installations/${installationId}/access_tokens`,
        { repository_ids: [repositoryId], permissions },
        { headers: githubHeaders(appJWT()), timeout: 15000 })
    if (typeof data.token !== 'string' || !data.token) throw new Error('Missing installation token')
    return data.token as string
}

export async function installationToken(installationId: number, repositoryId: number) {
    try { return await mintInstallationToken(installationId, repositoryId, { contents: 'read' }) }
    catch { throw new GitHubAccessError('Repository access was removed or GitHub is unavailable. Reconnect the repository.', 403) }
}

// Reporting credentials never reach build containers and cannot read code.
export async function deploymentReportingToken(installationId: number, repositoryId: number) {
    return mintInstallationToken(installationId, repositoryId, { deployments: 'write' })
}

export function repositoryFromURL(raw: unknown) {
    if (typeof raw !== 'string') throw new GitHubAccessError('A GitHub repository URL is required.', 400)
    const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(raw)
    if (!match || ['.', '..'].includes(match[1]) || ['.', '..'].includes(match[2])) throw new GitHubAccessError('Use a GitHub repository URL without a branch or folder suffix.', 400)
    return { owner: match[1], repo: match[2] }
}
