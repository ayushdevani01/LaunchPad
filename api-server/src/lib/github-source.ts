export class GitHubSourceError extends Error {}

export function githubSource(query: Record<string, unknown>) {
    const { owner, repo, branch = 'main', path = '' } = query
    if (typeof owner !== 'string' || typeof repo !== 'string' ||
        !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) ||
        [owner, repo].some(value => value === '.' || value === '..')) {
        throw new GitHubSourceError('A valid repository owner and name are required.')
    }
    if (typeof branch !== 'string' || !branch.trim() || /[\x00-\x1f\x7f]/.test(branch)) {
        throw new GitHubSourceError('A valid branch is required.')
    }
    if (typeof path !== 'string' || path.length > 1000 || /[\\\x00-\x1f\x7f]/.test(path) ||
        (path !== '' && path.split('/').some(part => !part || part === '.' || part === '..'))) {
        throw new GitHubSourceError('Use a relative folder path inside the repository.')
    }
    return { owner, repo, branch: branch.trim(), path }
}

export function githubContentsUrl(owner: string, repo: string, path: string) {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`
}
