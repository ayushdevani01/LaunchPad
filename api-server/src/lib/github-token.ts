import axios from 'axios'
import { IUser, User } from '../models/User'

const refreshing = new Map<string, Promise<string>>()

export function tokenFields(data: any, now = Date.now()) {
    if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('GitHub token exchange failed')
    const expires = data.expires_in === undefined ? undefined : Number(data.expires_in)
    if (expires !== undefined && (!Number.isFinite(expires) || expires <= 0 || !data.refresh_token)) throw new Error('GitHub token lifetime is invalid')
    return {
        githubToken: data.access_token as string,
        githubRefreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
        githubTokenExpiresAt: expires === undefined ? undefined : new Date(now + expires * 1000),
        githubRefreshExpiresAt: Number(data.refresh_token_expires_in) > 0 ? new Date(now + Number(data.refresh_token_expires_in) * 1000) : undefined
    }
}

export async function githubAccessToken(user: IUser | null): Promise<string> {
    if (!user?.githubToken) return ''
    if (!user.githubTokenExpiresAt || user.githubTokenExpiresAt.getTime() > Date.now() + 60000) return user.githubToken
    const id = user._id.toString()
    const pending = refreshing.get(id)
    if (pending) return pending
    const work = (async () => {
        // Re-read after another request may have rotated the token pair.
        const current = await User.findById(id)
        if (!current?.githubToken) throw new Error('Please sign in with GitHub again')
        if (!current.githubTokenExpiresAt || current.githubTokenExpiresAt.getTime() > Date.now() + 60000) return current.githubToken
        if (!current.githubRefreshToken || (current.githubRefreshExpiresAt && current.githubRefreshExpiresAt.getTime() <= Date.now())) throw new Error('Please sign in with GitHub again')
        let data: any
        try {
            const response = await axios.post('https://github.com/login/oauth/access_token', {
                client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET,
                grant_type: 'refresh_token', refresh_token: current.githubRefreshToken
            }, {headers: {Accept: 'application/json'}, timeout: 10000})
            data = response.data
        } catch { throw new Error('Please sign in with GitHub again') }
        const fields = tokenFields(data)
        const updated = await User.updateOne({_id: current._id, githubRefreshToken: current.githubRefreshToken}, {$set: fields})
        if (updated.modifiedCount !== 1) throw new Error('GitHub session changed; please retry')
        return fields.githubToken
    })()
    refreshing.set(id, work)
    try { return await work } finally { refreshing.delete(id) }
}
