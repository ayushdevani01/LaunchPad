import express, { Request, Response } from 'express'
import { Readable } from 'stream'

export interface WebRuntime {
    target?: string
    region?: string
    endpointUrl?: string
    functionName?: string
    staticPrefixes?: string[]
}
export interface Routing { slug: string; deploymentId: string; runtime?: WebRuntime }
export interface ProxyDependencies {
    resolve(slug: string): Promise<Routing | null>
    asset(key: string): Promise<{ body: Readable; contentType?: string; cacheControl?: string; etag?: string }>
    forward(runtime: WebRuntime, req: Request, res: Response): Promise<void>
}
export function validWebEndpoint(raw: string, region: string) {
    try {
        const url = new URL(raw)
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash &&
            new RegExp(`^[a-z0-9-]+\\.[a-z0-9-]+\\.lambda-web\\.${region.replace(/[^a-z0-9-]/g, '')}\\.on\\.aws$`).test(url.hostname)
    } catch { return false }
}
export function createApp(deps: ProxyDependencies) {
    const app = express()
    app.disable('x-powered-by')
    app.use(async (req, res) => {
        try {
            const slug = req.hostname.split('.')[0]
            if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return res.status(404).send('Project not found')
            const route = await deps.resolve(slug)
            if (!route) return res.status(404).send('No active deployment found for this project.')
            let path: string
            try { path = decodeURIComponent(req.originalUrl.split('?')[0]) }
            catch { return res.status(400).send('Invalid asset path') }
            if (path.includes('\0') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.')) return res.status(400).send('Invalid asset path')
            if (path === '/.launchpad/health') return res.status(404).end()
            const runtime = route.runtime
            const web = ['nextjs-web', 'nodejs-web'].includes(runtime?.target || '')
            if (runtime?.target && runtime.target !== 'static' && !web) return res.status(503).send('Redeploy this project to configure its runtime')
            const spa = web && runtime?.staticPrefixes?.includes('/')
            const isAsset = !web || (['GET', 'HEAD'].includes(req.method) &&
                (spa ? path !== '/api' && !path.startsWith('/api/') : runtime?.staticPrefixes?.some(prefix => prefix !== '/' && path.startsWith(prefix))))
            if (isAsset) {
                if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).send('Method not allowed')
                const prefix = `__outputs/${slug}/${route.deploymentId}`
                let asset
                try { asset = await deps.asset(prefix + (path === '/' ? '/index.html' : path)) }
                catch (error: any) {
                    if ((!spa && web) || !['NoSuchKey', 'NotFound'].includes(error.name)) throw error
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
            if (!runtime?.endpointUrl || !runtime.region || !validWebEndpoint(runtime.endpointUrl, runtime.region) ||
                !/^lp-[a-z0-9-]+-web$/.test(runtime.functionName || '')) return res.status(503).send('Web Function is not configured')
            await deps.forward(runtime, req, res)
        } catch (error: any) {
            if (res.headersSent) return res.destroy()
            if (['NoSuchKey', 'NotFound'].includes(error.name)) return res.status(404).send('Not found')
            console.error('Deployment routing failed:', error.name || 'Error')
            return res.status(502).send('Deployment is temporarily unavailable')
        }
    })
    return app
}
