import express, { Request } from 'express'
import { Readable } from 'stream'

export interface Routing {
    slug: string
    deploymentId: string
    runtime?: { target?: string; region?: string; serverFunction?: string; imageFunction?: string; publicFiles?: string[]; basePath?: string }
}
export interface ProxyDependencies {
    resolve(slug: string): Promise<Routing | null>
    asset(key: string): Promise<{ body: Readable; contentType?: string; cacheControl?: string; etag?: string }>
    invoke(name: string, region: string, event: object): Promise<Uint8Array>
}

export function lambdaEvent(req: Request) {
    const url = new URL(req.originalUrl, 'http://localhost')
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers)) if (value !== undefined && !['connection', 'transfer-encoding', 'content-length'].includes(key)) headers[key] = Array.isArray(value) ? value.join(',') : value
    headers['x-forwarded-host'] = headers.host
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
    const body = Buffer.isBuffer(req.body) && req.body.length ? req.body.toString('base64') : undefined
    return { version: '2.0', routeKey: '$default', rawPath: url.pathname, rawQueryString: url.search.slice(1), headers,
        cookies: req.headers.cookie?.split(/;\s*/), body, isBase64Encoded: !!body,
        requestContext: { http: { method: req.method, path: url.pathname, sourceIp: req.ip || '127.0.0.1', protocol: `HTTP/${req.httpVersion}` }, domainName: req.hostname } }
}

export function createApp(deps: ProxyDependencies) {
    const app = express()
    app.disable('x-powered-by')
    // Base64 encoding plus the event envelope must fit Lambda's 6 MB payload.
    app.use(express.raw({ type: () => true, limit: '4mb' }))
    app.use(async (req, res) => {
        try {
            const slug = req.hostname.split('.')[0]
            if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return res.status(404).send('Project not found')
            const route = await deps.resolve(slug)
            if (!route) return res.status(404).send('No active deployment found for this project.')
            const path = decodeURIComponent(new URL(req.originalUrl, 'http://localhost').pathname)
            if (path.includes('\0') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.')) return res.status(400).send('Invalid asset path')
            const runtime = route.runtime
            const next = runtime?.target === 'nextjs-lambda'
            const base = runtime?.basePath || ''
            const assetPath = base && path.startsWith(base + '/') ? path.slice(base.length) : path
            const isAsset = !next || assetPath.startsWith('/_next/static/') || (runtime?.publicFiles || []).includes(assetPath)
            if (isAsset) {
                if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).send('Method not allowed')
                const prefix = `__outputs/${slug}/${route.deploymentId}`
                let asset
                try { asset = await deps.asset(prefix + (assetPath === '/' ? '/index.html' : assetPath)) }
                catch (error: any) {
                    if (next || !['NoSuchKey', 'NotFound'].includes(error.name)) throw error
                    if (!(req.headers.accept || '').includes('text/html')) return res.status(404).send('Not found')
                    asset = await deps.asset(prefix + '/index.html')
                }
                if (asset.contentType) res.setHeader('Content-Type', asset.contentType)
                if (asset.cacheControl) res.setHeader('Cache-Control', asset.cacheControl)
                if (asset.etag) res.setHeader('ETag', asset.etag)
                if (req.method === 'HEAD') { asset.body.destroy(); return res.end() }
                asset.body.on('error', () => res.destroy())
                res.on('close', () => asset.body.destroy())
                return asset.body.pipe(res)
            }
            const name = assetPath === '/_next/image' && runtime?.imageFunction ? runtime.imageFunction : runtime?.serverFunction
            if (!name || !/^lp-[a-z0-9-]+-(server|image)$/.test(name) || !runtime?.region) return res.status(503).send('Runtime is not configured')
            const output = await deps.invoke(name, runtime.region, lambdaEvent(req))
            const response = JSON.parse(Buffer.from(output).toString('utf8'))
            if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) throw new Error('Invalid runtime response')
            for (const [key, value] of Object.entries(response.headers || {})) {
                if (!['connection', 'transfer-encoding', 'content-length'].includes(key.toLowerCase()) && typeof value === 'string') res.setHeader(key, value)
            }
            if (Array.isArray(response.cookies)) res.setHeader('Set-Cookie', response.cookies)
            res.status(response.statusCode)
            return res.end(Buffer.from(response.body || '', response.isBase64Encoded ? 'base64' : 'utf8'))
        } catch (error: any) {
            if (res.headersSent) return res.destroy()
            if (['NoSuchKey', 'NotFound'].includes(error.name)) return res.status(404).send('Not found')
            console.error('Deployment routing failed:', error.name || 'Error')
            return res.status(502).send('Deployment is temporarily unavailable')
        }
    })
    return app
}
