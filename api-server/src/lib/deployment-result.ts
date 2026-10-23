import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'
import { createHash } from 'node:crypto'

export interface RuntimeManifest {
    version: number
    projectId: string
    deploymentId: string
    target: 'static' | 'nextjs-web' | 'nodejs-web'
    assetPrefix: string
    region: string
    functionName?: string
    endpointUrl?: string
    staticPrefixes?: string[]
    nextVersion?: string
    runtime?: string
    architecture?: string
}

export function validateResult(value: any, slug: string, deploymentId: string) {
    if (!value || !['SUCCESS', 'FAILED'].includes(value.status)) throw new Error('Invalid deployment result')
    if (value.status === 'SUCCESS') {
        const m = value.manifest as RuntimeManifest
        if (!m || m.version !== 2 || m.projectId !== slug || m.deploymentId !== deploymentId ||
            m.assetPrefix !== `__outputs/${slug}/${deploymentId}` || !['static', 'nextjs-web', 'nodejs-web'].includes(m.target)) {
            throw new Error('Invalid deployment manifest')
        }
        if (m.target !== 'static') {
            const hash = createHash('sha256').update(deploymentId).digest('hex').slice(0, 12)
            if (m.functionName !== `lp-${slug.slice(0, 20).replace(/-+$/, '')}-${hash}-web` ||
                !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(m.region)) throw new Error('Invalid Web Function routing metadata')
            let endpoint: URL
            try { endpoint = new URL(m.endpointUrl || '') } catch { throw new Error('Invalid Web Function endpoint') }
            if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
                !new RegExp(`^[a-z0-9-]+\\.[a-z0-9-]+\\.lambda-web\\.${m.region}\\.on\\.aws$`).test(endpoint.hostname)) throw new Error('Invalid Web Function endpoint')
        }
        if (m.staticPrefixes && (!Array.isArray(m.staticPrefixes) || m.staticPrefixes.some(p => !['/', '/_next/static/'].includes(p)) || (m.target === 'nextjs-web' && m.staticPrefixes.includes('/')))) {
            throw new Error('Invalid static routing manifest')
        }
    }
    return value as { status: 'SUCCESS' | 'FAILED'; manifest?: RuntimeManifest; message?: string }
}

export async function readResult(client: S3Client, slug: string, id: string) {
    const output = await client.send(new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: `__deployments/${slug}/${id}/result.json` }), { abortSignal: AbortSignal.timeout(10000) })
    if (!output.Body) throw new Error('Deployment result is empty')
    return validateResult(JSON.parse(await output.Body.transformToString()), slug, id)
}

export async function publishResult(client: S3Client, project: any, deployment: any) {
    // A public callback is only a wake-up signal. Status and routing are trusted
    // only after reading the worker's result from private S3 using API IAM.
    const result = await readResult(client, project.slug, deployment._id.toString())
    const update = await Deployment.updateOne({ _id: deployment._id, status: { $in: ['PENDING', 'BUILDING'] } }, {
        $set: { status: result.status, runtime: result.manifest, failureReason: result.status === 'FAILED' ? (result.message || 'Build failed').slice(0, 2000) : undefined }
    })
    if (result.status === 'SUCCESS' && (update.modifiedCount > 0 || deployment.status === 'SUCCESS')) {
        // A slower old build must never roll a newer requested deployment back.
        await Project.updateOne({ _id: project._id, latestDeployment: deployment._id }, { $set: { currentDeployment: deployment._id } })
    }
    return result
}
