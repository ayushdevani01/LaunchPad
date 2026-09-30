import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { Deployment } from '../models/Deployment'
import { Project } from '../models/Project'

export interface RuntimeManifest {
    version: number
    projectId: string
    deploymentId: string
    target: 'static' | 'nextjs-lambda'
    assetPrefix: string
    region: string
    serverFunction?: string
    imageFunction?: string
    stackName?: string
    publicFiles?: string[]
    adapterVersion?: string
    nextVersion?: string
    runtime?: string
    architecture?: string
}

export function validateResult(value: any, slug: string, deploymentId: string) {
    if (!value || !['SUCCESS', 'FAILED'].includes(value.status)) throw new Error('Invalid deployment result')
    if (value.status === 'SUCCESS') {
        const m = value.manifest as RuntimeManifest
        if (!m || m.version !== 1 || m.projectId !== slug || m.deploymentId !== deploymentId ||
            m.assetPrefix !== `__outputs/${slug}/${deploymentId}` || !['static', 'nextjs-lambda'].includes(m.target)) {
            throw new Error('Invalid deployment manifest')
        }
        if (m.target === 'nextjs-lambda' && (!m.serverFunction || !/^lp-[a-z0-9-]+-server$/.test(m.serverFunction) ||
            !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(m.region))) throw new Error('Invalid Lambda routing metadata')
        if (m.imageFunction && !/^lp-[a-z0-9-]+-image$/.test(m.imageFunction)) throw new Error('Invalid image routing metadata')
        if (m.publicFiles && (!Array.isArray(m.publicFiles) || m.publicFiles.some(p => typeof p !== 'string' || !p.startsWith('/')))) {
            throw new Error('Invalid public file manifest')
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
