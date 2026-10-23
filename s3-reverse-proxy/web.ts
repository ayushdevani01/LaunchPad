import { request as httpsRequest } from 'node:https'
import { Transform } from 'node:stream'
import { Request, Response } from 'express'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { Hash } from '@smithy/hash-node'
import { WebRuntime } from './app'

const credentials = fromNodeProviderChain()
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'expect'])
export function viewerHeaders(req: Request, hostname: string) {
    const headers: Record<string, string> = {}
    const connection = new Set((req.headers.connection || '').toLowerCase().split(',').map(value => value.trim()))
    for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined && !hopHeaders.has(key) && !connection.has(key) && !key.startsWith('x-amz-') && !key.startsWith('x-launchpad-') && !['authorization', 'host', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for'].includes(key)) headers[key] = Array.isArray(value) ? value.join(', ') : value
    }
    headers.host = hostname
    headers['x-forwarded-host'] = req.headers.host || req.hostname
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
    headers['x-forwarded-for'] = req.socket.remoteAddress || ''
    if (req.headers.authorization) headers['x-launchpad-authorization'] = req.headers.authorization
    // Required by Lambda IAM auth. TLS protects the streamed request body.
    headers['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD'
    return headers
}
export async function forwardWeb(runtime: WebRuntime, req: Request, res: Response) {
    const endpoint = new URL(runtime.endpointUrl!)
    const incoming = new URL(req.originalUrl, 'https://localhost')
    const query: Record<string, string[]> = {}
    incoming.searchParams.forEach((value, key) => { (query[key] ||= []).push(value) })
    const signer = new SignatureV4({ credentials, region: runtime.region!, service: 'lambda', sha256: Hash.bind(null, 'sha256') })
    // Lambda appends the origin IP to this header before IAM validation.
    // Signing its pre-transport value produces a signature mismatch.
    const signed = await signer.sign(new HttpRequest({ protocol: 'https:', hostname: endpoint.hostname, method: req.method, path: incoming.pathname, query, headers: viewerHeaders(req, endpoint.hostname) }), { unsignableHeaders: new Set(['x-forwarded-for']) })
    await new Promise<void>((resolve, reject) => {
        let bytes = 0
        const limiter = new Transform({ transform(chunk, _encoding, callback) {
            bytes += chunk.length
            callback(bytes > 64 * 1024 * 1024 ? Object.assign(new Error('RequestBodyTooLarge'), { name: 'RequestBodyTooLarge' }) : null, chunk)
        } })
        const upstream = httpsRequest({ hostname: endpoint.hostname, path: req.originalUrl, method: req.method, headers: signed.headers, timeout: 35000 }, response => {
            res.status(response.statusCode || 502)
            const connection = new Set((response.headers.connection || '').toLowerCase().split(',').map(value => value.trim()))
            for (const [key, value] of Object.entries(response.headers)) {
                if (value !== undefined && !hopHeaders.has(key) && !connection.has(key)) res.setHeader(key, value)
            }
            // Pipe the original bytes, compression, cookies and chunk timing.
            response.on('error', reject)
            response.on('end', resolve)
            response.pipe(res)
        })
        upstream.on('timeout', () => upstream.destroy(new Error('WebFunctionTimeout')))
        upstream.on('error', reject)
        limiter.on('error', error => { upstream.destroy(error); if (!res.headersSent) res.status(413).end('Request body too large') })
        const close = () => { if (!res.writableFinished) upstream.destroy() }
        res.once('close', close)
        req.once('aborted', () => upstream.destroy())
        upstream.once('close', () => { res.off('close', close); req.unpipe(limiter); limiter.destroy() })
        req.pipe(limiter).pipe(upstream)
    })
}
